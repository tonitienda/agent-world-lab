// Package executor supervises argument-array subprocesses without a shell.
package executor

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"syscall"
	"time"
)

type Request struct {
	Program        string
	Args           []string
	Dir            string
	Env            []string
	Stdin          io.Reader
	Stdout, Stderr io.Writer
	OnCancel       func()
}
type Result struct {
	ExitCode int
	Duration time.Duration
}
type Runner interface {
	Run(context.Context, Request) (Result, error)
}
type OS struct{ Grace time.Duration }

func (r OS) Run(ctx context.Context, q Request) (Result, error) {
	start := time.Now()
	if e := ctx.Err(); e != nil {
		return Result{}, e
	}
	cmd := exec.Command(q.Program, q.Args...)
	cmd.Dir = q.Dir
	cmd.Env = q.Env
	if cmd.Env == nil {
		cmd.Env = os.Environ()
	}
	cmd.Stdin = q.Stdin
	stdout, stderr := newSecretWriter(q.Stdout, cmd.Env), newSecretWriter(q.Stderr, cmd.Env)
	defer stdout.flush()
	defer stderr.flush()
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.WaitDelay = 5 * time.Second
	if e := cmd.Start(); e != nil {
		return Result{ExitCode: -1}, fmt.Errorf("start %s: %w (install it and check PATH)", q.Program, e)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	var err error
	select {
	case err = <-done:
	case <-ctx.Done():
		if q.OnCancel != nil {
			q.OnCancel()
		} else {
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
		}
		grace := r.Grace
		if grace == 0 {
			grace = 90 * time.Second
		}
		timer := time.NewTimer(grace)
		select {
		case <-done:
			timer.Stop()
		case <-timer.C:
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			<-done
		}
		err = ctx.Err()
	}
	result := Result{ExitCode: cmd.ProcessState.ExitCode(), Duration: time.Since(start)}
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return result, fmt.Errorf("%s exited %d: %w", q.Program, result.ExitCode, err)
		}
		return result, err
	}
	return result, nil
}
