package executor

import (
	"io"
	"strings"
)

// secretWriter retains enough trailing text to redact secrets split over writes.
type secretWriter struct {
	out     io.Writer
	secrets []string
	pending string
	retain  int
}

func newSecretWriter(out io.Writer, env []string) *secretWriter {
	if out == nil {
		out = io.Discard
	}
	w := &secretWriter{out: out}
	for _, v := range env {
		k, value, _ := strings.Cut(v, "=")
		k = strings.ToUpper(k)
		if len(value) >= 8 && (strings.Contains(k, "KEY") || strings.Contains(k, "TOKEN") || strings.Contains(k, "SECRET") || k == "EMERGENCE_LEASE") {
			w.secrets = append(w.secrets, value)
			if len(value) > w.retain {
				w.retain = len(value)
			}
		}
	}
	return w
}
func (w *secretWriter) clean() {
	for _, s := range w.secrets {
		w.pending = strings.ReplaceAll(w.pending, s, "[REDACTED]")
	}
}
func (w *secretWriter) Write(b []byte) (int, error) {
	w.pending += string(b)
	w.clean()
	n := len(w.pending) - w.retain
	if n <= 0 {
		return len(b), nil
	}
	_, e := io.WriteString(w.out, w.pending[:n])
	w.pending = w.pending[n:]
	return len(b), e
}
func (w *secretWriter) flush() error {
	w.clean()
	_, e := io.WriteString(w.out, w.pending)
	w.pending = ""
	return e
}
