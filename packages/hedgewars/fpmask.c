// LD_PRELOAD shim for arm64. The FreePascal runtime turns on floating-point
// traps; Mesa's software renderers then crash the engine with EInvalidOp on
// harmless NaN/inf arithmetic. We clear the trap-enable bits whenever the
// engine enters SDL (start-up, window creation, every frame swap).
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdint.h>

static inline void mask_fp_traps(void) {
#if defined(__aarch64__)
  uint64_t fpcr;
  __asm__ volatile("mrs %0, fpcr" : "=r"(fpcr));
  fpcr &= ~(uint64_t)0x9f00; // IOE, DZE, OFE, UFE, IXE, IDE
  __asm__ volatile("msr fpcr, %0" : : "r"(fpcr));
#endif
}

#define WRAP(ret, name, params, args)                          \
  ret name params {                                            \
    static ret (*real) params;                                 \
    if (!real) real = (ret (*) params)dlsym(RTLD_NEXT, #name); \
    mask_fp_traps();                                           \
    return real args;                                          \
  }

WRAP(int, SDL_Init, (uint32_t flags), (flags))
WRAP(void *, SDL_CreateWindow, (const char *t, int x, int y, int w, int h, uint32_t f), (t, x, y, w, h, f))
WRAP(void *, SDL_GL_CreateContext, (void *window), (window))
WRAP(void, SDL_GL_SwapWindow, (void *window), (window))
WRAP(int, SDL_PollEvent, (void *event), (event))
