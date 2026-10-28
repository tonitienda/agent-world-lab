/** Save every camera even if another camera fails. Concurrent callers share completion. */
function createFinalizer(tasks, cleanup) {
  let pending;
  return () =>
    (pending ??= (async () => {
      const errors = [];
      for (const task of tasks) {
        try {
          await task();
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length)
        throw new AggregateError(
          errors,
          "Recording finalization failed; retained camera intermediates may be recoverable",
        );
    })());
}
module.exports = { createFinalizer };
