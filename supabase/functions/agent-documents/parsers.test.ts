import { zipSync } from "fflate";
import {
  chunkText,
  extractDocxText,
  extractPdfText,
  verifyStoredUpload,
} from "./index.ts";

function assert(
  condition: unknown,
  message = "assertion_failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function makePdf(text: string) {
  const stream = `BT /F1 16 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${object}\n`;
  }
  const xrefOffset = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${
    objects.length + 1
  } /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

Deno.test("validated PDF bytes still extract with the production parser", async () => {
  const bytes = makePdf("MediumIA document PDF test");
  const admin = {
    storage: {
      from: () => ({
        download: async () => ({
          data: new Blob([bytes], { type: "application/pdf" }),
          error: null,
        }),
      }),
    },
  };
  const verified = await verifyStoredUpload(admin, {
    name: "source.pdf",
    storage_bucket: "agent-documents",
    storage_path: "private/source.pdf",
    mime_type: "application/pdf",
    size_bytes: bytes.length,
  });
  const extracted = await extractPdfText(verified.bytes);
  assert(extracted.text.includes("MediumIA document PDF test"));
  assert(/^[0-9a-f]{64}$/.test(verified.contentSha256));
});

Deno.test("validated DOCX bytes still extract with the production parser", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body><w:p><w:r><w:t>MediumIA document Word test</w:t></w:r></w:p></w:body>
    </w:document>`;
  const bytes = zipSync({
    "word/document.xml": new TextEncoder().encode(xml),
  });
  const admin = {
    storage: {
      from: () => ({
        download: async () => ({
          data: new Blob([bytes], {
            type:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
          error: null,
        }),
      }),
    },
  };
  const verified = await verifyStoredUpload(admin, {
    name: "source.docx",
    storage_bucket: "agent-documents",
    storage_path: "private/source.docx",
    mime_type:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size_bytes: bytes.length,
  });
  const extracted = extractDocxText(verified.bytes);
  assert(extracted.text.includes("MediumIA document Word test"));
});

Deno.test("server verification rejects forged PDF bytes and size mismatches", async () => {
  const bytes = new TextEncoder().encode("not a PDF");
  const admin = {
    storage: {
      from: () => ({
        download: async () => ({ data: new Blob([bytes]), error: null }),
      }),
    },
  };

  await assertRejects(
    () =>
      verifyStoredUpload(admin, {
        name: "source.pdf",
        storage_path: "private/source.pdf",
        mime_type: "application/pdf",
        size_bytes: bytes.length,
      }),
    "invalid_pdf_signature",
  );
  await assertRejects(
    () =>
      verifyStoredUpload(admin, {
        name: "source.txt",
        storage_path: "private/source.txt",
        mime_type: "text/plain",
        size_bytes: bytes.length + 1,
      }),
    "upload_size_mismatch",
  );
});

Deno.test("chunking remains capped at 120 chunks", () => {
  const chunks = chunkText("MediumIA ".repeat(100_000), 100, 10);
  assert(
    chunks.length === 120,
    `expected 120 chunks, received ${chunks.length}`,
  );
});

async function assertRejects(run: () => Promise<unknown>, code: string) {
  try {
    await run();
    throw new Error("expected_rejection");
  } catch (error) {
    assert(
      String(error).includes(code),
      `expected ${code}, received ${String(error)}`,
    );
  }
}
