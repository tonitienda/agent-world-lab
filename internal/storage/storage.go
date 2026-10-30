// Package storage provides confined paths, atomic metadata and content identities.
package storage

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

var identifier = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$`)

func ID(s string) error {
	if !identifier.MatchString(s) {
		return fmt.Errorf("invalid identifier %q (letters, numbers and hyphens only)", s)
	}
	return nil
}

// Path rejects symlinks in every existing component, including parents of root.
func Path(root string, parts ...string) (string, error) {
	root, err := filepath.Abs(root)
	// macOS exposes its system temporary roots through fixed OS-owned aliases.
	if runtime.GOOS == "darwin" {
		for _, alias := range []string{"/var", "/tmp"} {
			if root == alias || strings.HasPrefix(root, alias+"/") {
				root = "/private" + root
				break
			}
		}
	}
	if err != nil {
		return "", err
	}
	p := root
	for _, part := range parts {
		if filepath.IsAbs(part) {
			return "", fmt.Errorf("absolute artifact path: %s", part)
		}
		p = filepath.Join(p, part)
	}
	rel, err := filepath.Rel(root, p)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("path escapes %s", root)
	}
	current := string(os.PathSeparator)
	for _, part := range strings.Split(strings.TrimPrefix(p, string(os.PathSeparator)), string(os.PathSeparator)) {
		current = filepath.Join(current, part)
		s, e := os.Lstat(current)
		if os.IsNotExist(e) {
			continue
		}
		if e != nil {
			return "", e
		}
		if s.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("symlink is not allowed: %s", current)
		}
	}
	return p, nil
}
func JSON(path string, value any) error {
	b, e := json.MarshalIndent(value, "", "  ")
	if e != nil {
		return e
	}
	return Write(path, append(b, '\n'))
}
func Write(path string, b []byte) error {
	if _, e := Path(filepath.Dir(path), filepath.Base(path)); e != nil {
		return e
	}
	if e := os.MkdirAll(filepath.Dir(path), 0755); e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".emergence-*")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if e = f.Chmod(0600); e == nil {
		_, e = f.Write(b)
	}
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e != nil {
		return e
	}
	if ce != nil {
		return ce
	}
	return os.Rename(f.Name(), path)
}
func ReadJSON(path string, v any) error {
	if _, e := Path(filepath.Dir(path), filepath.Base(path)); e != nil {
		return e
	}
	b, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	return json.Unmarshal(b, v)
}
func Hash(root string) (string, error) {
	h := sha256.New()
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink in snapshot: %s", p)
		}
		if d.IsDir() {
			return nil
		}
		if !d.Type().IsRegular() {
			return fmt.Errorf("nonregular artifact: %s", p)
		}
		rel, _ := filepath.Rel(root, p)
		fmt.Fprintf(h, "%s\x00", filepath.ToSlash(rel))
		f, e := os.Open(p)
		if e != nil {
			return e
		}
		s, e := f.Stat()
		if e != nil {
			f.Close()
			return e
		}
		fmt.Fprintf(h, "%d\x00", s.Size())
		_, e = io.Copy(h, f)
		f.Close()
		return e
	})
	return hex.EncodeToString(h.Sum(nil)), err
}
func CopyTree(source, destination string) error {
	return filepath.WalkDir(source, func(p string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		rel, _ := filepath.Rel(source, p)
		target, e := Path(destination, rel)
		if e != nil {
			return e
		}
		if d.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink source: %s", p)
		}
		if d.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		if !d.Type().IsRegular() {
			return fmt.Errorf("nonregular source: %s", p)
		}
		src, e := os.Open(p)
		if e != nil {
			return e
		}
		out, e := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			src.Close()
			return e
		}
		_, e = io.Copy(out, src)
		src.Close()
		ce := out.Close()
		if e != nil {
			return e
		}
		return ce
	})
}

// PlainTree checks artifact types without reading or hashing large video files.
func PlainTree(root string) error {
	if _, e := Path(filepath.Dir(root), filepath.Base(root)); e != nil {
		return e
	}
	return filepath.WalkDir(root, func(p string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.Type()&os.ModeSymlink != 0 || (!d.IsDir() && !d.Type().IsRegular()) {
			return fmt.Errorf("unsafe artifact type: %s", p)
		}
		return nil
	})
}
