// Fills in browser features that pdf.js expects but some browsers lack.
// Imported before pdf.js (see pdf.ts).

// Safari (and so every iPhone browser) can't loop over a stream with
// `for await (const chunk of stream)`. pdf.js reads each page's text that way,
// so without this every book fails with "undefined is not a function".
const RS = globalThis.ReadableStream
if (RS && !(Symbol.asyncIterator in RS.prototype)) {
  Object.defineProperty(RS.prototype, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value: async function* (this: ReadableStream) {
      const reader = this.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) return
          yield value
        }
      } finally {
        reader.releaseLock()
      }
    },
  })
}

export {}
