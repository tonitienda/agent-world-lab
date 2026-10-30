package executor

import (
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func TestProcessHelper(t *testing.T) {
	if os.Getenv("EMERGENCE_HELPER") != "1" {
		return
	}
	switch os.Getenv("HELPER_MODE") {
	case "fail":
		os.Stderr.WriteString("expected failure")
		os.Exit(7)
	case "sleep":
		time.Sleep(time.Minute)
	default:
		b := new(bytes.Buffer)
		b.ReadFrom(os.Stdin)
		os.Stdout.Write(b.Bytes())
	}
	os.Exit(0)
}
func request(mode string) Request {
	return Request{Program: os.Args[0], Args: []string{"-test.run=TestProcessHelper"}, Env: append(os.Environ(), "EMERGENCE_HELPER=1", "HELPER_MODE="+mode)}
}
func TestExitStatusAndStdin(t *testing.T) {
	q := request("echo")
	out := new(bytes.Buffer)
	q.Stdout = out
	q.Stdin = strings.NewReader("multiline\nprompt")
	result, e := (OS{}).Run(context.Background(), q)
	if e != nil || result.ExitCode != 0 || out.String() != "multiline\nprompt" {
		t.Fatalf("%+v %v %s", result, e, out)
	}
	result, e = (OS{}).Run(context.Background(), request("fail"))
	if e == nil || result.ExitCode != 7 {
		t.Fatalf("%+v %v", result, e)
	}
}
func TestCancellationAndTimeout(t *testing.T) {
	for _, timeout := range []bool{false, true} {
		ctx, cancel := context.WithCancel(context.Background())
		if timeout {
			ctx, cancel = context.WithTimeout(context.Background(), 50*time.Millisecond)
		} else {
			go func() { time.Sleep(50 * time.Millisecond); cancel() }()
		}
		called := false
		q := request("sleep")
		q.OnCancel = func() { called = true }
		start := time.Now()
		_, e := (OS{Grace: 20 * time.Millisecond}).Run(ctx, q)
		cancel()
		if !called || time.Since(start) > 2*time.Second {
			t.Fatal("cancellation not supervised")
		}
		if timeout && !errors.Is(e, context.DeadlineExceeded) {
			t.Fatal(e)
		}
		if !timeout && !errors.Is(e, context.Canceled) {
			t.Fatal(e)
		}
	}
}

func TestSecretsNeverReachLogsAcrossWriteBoundaries(t *testing.T) {
	out := new(bytes.Buffer)
	w := newSecretWriter(out, []string{"OPENAI_API_KEY=secret-long-value", "EMERGENCE_LEASE=private-lease-token"})
	for _, part := range []string{"prefix secret-", "long-value private-", "lease-token suffix"} {
		if _, e := w.Write([]byte(part)); e != nil {
			t.Fatal(e)
		}
	}
	w.flush()
	if strings.Contains(out.String(), "secret-long-value") || strings.Contains(out.String(), "private-lease-token") {
		t.Fatal(out.String())
	}
	if out.String() != "prefix [REDACTED] [REDACTED] suffix" {
		t.Fatal(out.String())
	}
}
