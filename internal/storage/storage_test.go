package storage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestConfinement(t *testing.T) {
	root := t.TempDir()
	for _, s := range []string{"../escape", "/absolute", "x/../../escape"} {
		if _, e := Path(root, s); e == nil {
			t.Fatalf("accepted %s", s)
		}
	}
	os.Symlink(t.TempDir(), filepath.Join(root, "link"))
	if _, e := Path(root, "link/child"); e == nil {
		t.Fatal("accepted symlink parent")
	}
	for _, id := range []string{"..", "../foo", "a/b", "a b", "", "-start"} {
		if ID(id) == nil {
			t.Fatal(id)
		}
	}
}
func TestAtomicAndIdentity(t *testing.T) {
	d := t.TempDir()
	if e := JSON(filepath.Join(d, "state.json"), map[string]string{"state": "ready"}); e != nil {
		t.Fatal(e)
	}
	h, e := Hash(d)
	if e != nil {
		t.Fatal(e)
	}
	if e = JSON(filepath.Join(d, "state.json"), map[string]string{"state": "changed"}); e != nil {
		t.Fatal(e)
	}
	h2, _ := Hash(d)
	if h == h2 {
		t.Fatal("mutation did not change hash")
	}
	copy := t.TempDir()
	if e = CopyTree(d, copy); e != nil {
		t.Fatal(e)
	}
	h3, _ := Hash(copy)
	if h3 != h2 {
		t.Fatal("copy identity differs")
	}
	if CopyTree(d, copy) == nil {
		t.Fatal("overwrote existing files")
	}
	os.Symlink("state.json", filepath.Join(d, "alias"))
	if _, e = Hash(d); e == nil {
		t.Fatal("hashed symlink")
	}
}
