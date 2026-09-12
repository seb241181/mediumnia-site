import { createClient } from "@supabase/supabase-js";
import { unzipSync } from "fflate";
import { extractText, getDocumentProxy } from "unpdf";
import {
  actorContext,
  clientRequestId,
  documentErrorStatus,
  extractionAttemptWasFinalized,
  MAX_CHUNKS,
  MAX_FILE_BYTES,
  type RpcCaller,
  runShadowDeletionSaga,
  runShadowExtraction,
  safeErrorCode,
  scopedRequestId,
  setShadowApproval,
  sha256Hex,
  type ShadowVersion,
} from "./bridge.ts";

const BUCKET = "agent-documents";
const MAX_TEXT_CHARS = 750_000;
const MAX_PDF_PAGES = 400;
const MAX_DOCX_XML_BYTES = 10 * 1024 * 1024;
const EXTRACTION_TIMEOUT_MS = 20_000;
const MIN_EXTRACTED_TEXT_CHARS = 12;
const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);
const GENERIC_MIME_TYPES = new Set([
  "application/octet-stream",
  "application/zip",
  "",
]);
const ALLOWED_EXTENSIONS = /\.(pdf|txt|md|csv|json|docx)$/i;
const TEXT_EXTENSIONS = /\.(txt|md|csv|json)$/i;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 240) : "";
}

function normalizeExtractedText(value: string) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function chunkText(text: string, maxLength = 5000, overlap = 400) {
  const clean = normalizeExtractedText(text);
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < MAX_CHUNKS) {
    let end = Math.min(clean.length, start + maxLength);
    if (end < clean.length) {
      const paragraph = clean.lastIndexOf("\n\n", end);
      const sentence = clean.lastIndexOf(". ", end);
      const candidate = Math.max(paragraph, sentence);
      if (candidate > start + Math.floor(maxLength * 0.55)) end = candidate + 1;
    }
    const content = clean.slice(start, end).trim();
    if (content) chunks.push(content);
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

function expectedMimeType(name: string) {
  if (/\.pdf$/i.test(name)) return PDF_MIME;
  if (/\.docx$/i.test(name)) return DOCX_MIME;
  if (/\.md$/i.test(name)) return "text/markdown";
  if (/\.csv$/i.test(name)) return "text/csv";
  if (/\.json$/i.test(name)) return "application/json";
  if (/\.txt$/i.test(name)) return "text/plain";
  return "";
}

function isAllowedFile(name: string, mimeType: string) {
  if (!ALLOWED_EXTENSIONS.test(name)) return false;
  const mime = String(mimeType || "").trim().toLowerCase();
  const expected = expectedMimeType(name);
  if (mime === expected || GENERIC_MIME_TYPES.has(mime)) return true;
  if (
    TEXT_EXTENSIONS.test(name) &&
    (TEXT_MIME_TYPES.has(mime) || mime === "application/vnd.ms-excel")
  ) return true;
  return false;
}

function looksLikePdf(bytes: Uint8Array) {
  return bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d;
}

function looksLikeZip(bytes: Uint8Array) {
  return bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08));
}

function decodeXmlEntities(value: string) {
  return value
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(
      /&#([0-9]+);/g,
      (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function docxXmlToText(xml: string) {
  const withoutMarkup = xml
    .replace(/<w:tab\b[^>]*\/>/gi, "\t")
    .replace(/<w:(?:br|cr)\b[^>]*\/>/gi, "\n")
    .replace(/<\/w:tc>/gi, "\t")
    .replace(/<\/w:tr>/gi, "\n")
    .replace(/<\/w:p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return normalizeExtractedText(decodeXmlEntities(withoutMarkup));
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  code: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(code)), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function extractPdfText(bytes: Uint8Array) {
  if (!looksLikePdf(bytes)) throw new Error("invalid_pdf_signature");
  const pdf = await getDocumentProxy(bytes);
  try {
    const totalPages = Number(pdf.numPages || 0);
    if (!Number.isInteger(totalPages) || totalPages <= 0) {
      throw new Error("invalid_pdf");
    }
    if (totalPages > MAX_PDF_PAGES) throw new Error("pdf_page_limit");

    const extracted = await withTimeout(
      extractText(pdf, { mergePages: true }),
      EXTRACTION_TIMEOUT_MS,
      "pdf_extraction_timeout",
    );
    const rawText = Array.isArray(extracted.text)
      ? extracted.text.join("\n\n")
      : extracted.text;
    const text = normalizeExtractedText(rawText);
    if (text.length < MIN_EXTRACTED_TEXT_CHARS) {
      throw new Error("pdf_no_extractable_text");
    }
    return {
      text,
      metadata: {
        extraction_parser: "unpdf@1.8.1",
        extraction_pages: totalPages,
        extracted_chars: text.length,
      },
    };
  } finally {
    try {
      await (pdf as { destroy?: () => Promise<void> | void }).destroy?.();
    } catch { /* best-effort cleanup */ }
  }
}

export function extractDocxText(bytes: Uint8Array) {
  if (!looksLikeZip(bytes)) throw new Error("invalid_docx_signature");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(file) {
        return file.name === "word/document.xml" &&
          file.originalSize <= MAX_DOCX_XML_BYTES;
      },
    });
  } catch {
    throw new Error("invalid_docx");
  }
  const documentXml = files["word/document.xml"];
  if (!documentXml) throw new Error("docx_document_xml_missing");
  const text = docxXmlToText(new TextDecoder().decode(documentXml));
  if (text.length < MIN_EXTRACTED_TEXT_CHARS) {
    throw new Error("docx_no_extractable_text");
  }
  return {
    text,
    metadata: {
      extraction_parser: "fflate-docx@0.8.3",
      extracted_chars: text.length,
    },
  };
}

export function extractPlainText(bytes: Uint8Array) {
  const text = normalizeExtractedText(
    new TextDecoder().decode(bytes).replace(/^\uFEFF/, ""),
  );
  if (!text) throw new Error("empty_document_text");
  return {
    text,
    metadata: {
      extraction_parser: "text-decoder",
      extracted_chars: text.length,
    },
  };
}

async function extractBytes(bytes: Uint8Array, name: string) {
  if (/\.pdf$/i.test(name)) return await extractPdfText(bytes);
  if (/\.docx$/i.test(name)) return extractDocxText(bytes);
  if (TEXT_EXTENSIONS.test(name)) return extractPlainText(bytes);
  throw new Error("unsupported_document_type");
}

export async function verifyStoredUpload(
  admin: any,
  source: Record<string, any>,
) {
  const storageBucket = String(source.storage_bucket || BUCKET);
  const storagePath = String(source.storage_path || "");
  const displayName = String(source.name || storagePath);
  const expectedSize = Number(source.size_bytes);
  if (!storagePath) throw new Error("storage_path_missing");
  if (!isAllowedFile(displayName, String(source.mime_type || ""))) {
    throw new Error("unsupported_document_type");
  }

  const { data: blob, error } = await admin.storage
    .from(storageBucket)
    .download(storagePath, {}, { cache: "no-store" });
  if (error || !blob) throw new Error("storage_download_failed");
  if (blob.size <= 0) throw new Error("stored_file_empty");
  if (blob.size > MAX_FILE_BYTES) throw new Error("stored_file_too_large");
  if (
    Number.isFinite(expectedSize) && expectedSize > 0 &&
    blob.size !== expectedSize
  ) {
    throw new Error("upload_size_mismatch");
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (/\.pdf$/i.test(displayName) && !looksLikePdf(bytes)) {
    throw new Error("invalid_pdf_signature");
  }
  if (/\.docx$/i.test(displayName) && !looksLikeZip(bytes)) {
    throw new Error("invalid_docx_signature");
  }

  return {
    bytes,
    contentSha256: await sha256Hex(bytes),
    name: displayName,
    storageBucket,
    storagePath,
  };
}

function rpcErrorCode(error: any) {
  const message = String(error?.message || error?.details || error?.hint || "");
  const known = message.match(/([a-z][a-z0-9_]{2,159})/g) || [];
  return known.find((value) => value.includes("_")) || "document_bridge_failed";
}

function createRpcCaller(admin: any): RpcCaller {
  return async (name, args) => {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new Error(rpcErrorCode(error));
    if (Array.isArray(data)) return data[0] || null;
    return data || null;
  };
}

async function getShadowDocument(admin: any, documentId: string) {
  const { data, error } = await admin
    .from("pro_documents")
    .select(
      "id, workspace_id, current_version_id, lifecycle_status, ai_enabled",
    )
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error("shadow_document_lookup_failed");
  return data || null;
}

async function getShadowVersion(
  admin: any,
  document: Record<string, any>,
  shadowDocument: Record<string, any>,
) {
  const metadataVersionId =
    typeof document.metadata?.shadow_version_id === "string"
      ? document.metadata.shadow_version_id
      : "";
  const preferredVersionId = metadataVersionId ||
    shadowDocument.current_version_id || "";

  if (preferredVersionId) {
    const { data, error } = await admin
      .from("pro_document_versions")
      .select(
        "id, document_id, storage_bucket, storage_path, mime_type, size_bytes, extraction_status, upload_verified_at, metadata, version_number, published_at",
      )
      .eq("id", preferredVersionId)
      .eq("document_id", document.id)
      .maybeSingle();
    if (error) throw new Error("shadow_version_lookup_failed");
    if (data) return data;
  }

  const { data, error } = await admin
    .from("pro_document_versions")
    .select(
      "id, document_id, storage_bucket, storage_path, mime_type, size_bytes, extraction_status, upload_verified_at, metadata, version_number, published_at",
    )
    .eq("document_id", document.id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error("shadow_version_not_found");
  return data;
}

async function processShadowUploadedDocument({
  admin,
  rpc,
  actorUserId,
  document,
  shadowDocument,
  operationId,
}: {
  admin: any;
  rpc: RpcCaller;
  actorUserId: string;
  document: Record<string, any>;
  shadowDocument: Record<string, any>;
  operationId: string;
}) {
  const version = await getShadowVersion(admin, document, shadowDocument) as
    & ShadowVersion
    & Record<string, any>;
  const source = { ...version, name: version.storage_path || document.name };
  return await runShadowExtraction({
    version,
    actorUserId,
    operationId,
    rpc,
    verifySource: async () => await verifyStoredUpload(admin, source),
    extractSource: async (bytes) => {
      const extracted = await extractBytes(bytes, String(source.name));
      if (extracted.text.length > MAX_TEXT_CHARS) {
        throw new Error("text_too_large");
      }
      const chunks = chunkText(extracted.text);
      if (!chunks.length) throw new Error("empty_document_text");
      return {
        chunks: chunks.map((content, chunkIndex) => ({
          chunk_index: chunkIndex,
          content,
        })),
        metadata: extracted.metadata,
      };
    },
  });
}

export async function handleAgentDocumentsRequest(
  req: Request,
  createClientImpl = createClient,
) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return response({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return response({ error: "server_configuration" }, 503);
  }

  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return response({ error: "unauthenticated" }, 401);
  }

  const userClient = createClientImpl(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const admin = createClientImpl(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return response({ error: "unauthenticated" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return response({ error: "invalid_json" }, 400);
  }

  const action = typeof body.action === "string" ? body.action : "";
  const agentId = typeof body.agentId === "string" ? body.agentId : "";
  if (!action || !agentId) return response({ error: "invalid_request" }, 400);

  const { data: agent } = await admin
    .from("agents")
    .select("id, owner_id, membership_id, workspace_id, status")
    .eq("id", agentId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!agent || !["active", "draft"].includes(agent.status)) {
    return response({ error: "copilot_not_found" }, 404);
  }

  const { data: membership } = await admin
    .from("pro_memberships")
    .select("id, workspace_id, expires_at")
    .eq("id", agent.membership_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (
    !membership ||
    membership.workspace_id !== agent.workspace_id ||
    (membership.expires_at && new Date(membership.expires_at) <= new Date())
  ) {
    return response({ error: "pro_access_required" }, 403);
  }

  const context = actorContext(user, agent);
  const operationId = clientRequestId(body.requestId);
  const rpc = createRpcCaller(admin);

  const audit = async (
    eventType: string,
    documentId: string,
    details: Record<string, unknown> = {},
  ) => {
    await admin.from("agent_audit_events").insert({
      owner_id: user.id,
      agent_id: agent.id,
      event_type: eventType,
      resource_type: "document",
      resource_id: documentId,
      details: { result: "success", ...details },
    });
  };

  const auditFailure = async (documentId: string, code: string) => {
    await admin.from("agent_audit_events").insert({
      owner_id: user.id,
      agent_id: agent.id,
      event_type: "document_extraction_failed",
      resource_type: "document",
      resource_id: documentId,
      details: { result: "error", code },
    });
  };

  const getDocument = async (documentId: unknown) => {
    if (typeof documentId !== "string" || !documentId) return null;
    const { data } = await admin
      .from("agent_documents")
      .select(
        "id, agent_id, owner_id, name, source_type, storage_bucket, storage_path, mime_type, size_bytes, status, approved_for_ai, metadata",
      )
      .eq("id", documentId)
      .eq("agent_id", agent.id)
      .eq("owner_id", user.id)
      .maybeSingle();
    return data || null;
  };

  const indexLegacyText = async (
    document: Record<string, any>,
    text: string,
    metadata: Record<string, unknown> = {},
  ) => {
    if (text.length > MAX_TEXT_CHARS) throw new Error("text_too_large");
    const chunks = chunkText(text);
    if (!chunks.length) throw new Error("empty_document_text");

    await admin.from("agent_document_chunks").delete().eq(
      "document_id",
      document.id,
    ).eq("agent_id", agent.id).eq("owner_id", user.id);
    const { error: chunkError } = await admin.from("agent_document_chunks")
      .insert(
        chunks.map((content, chunkIndex) => ({
          document_id: document.id,
          agent_id: agent.id,
          owner_id: user.id,
          chunk_index: chunkIndex,
          content,
        })),
      );
    if (chunkError) throw new Error("chunk_persistence_failed");

    const { error: updateError } = await admin
      .from("agent_documents")
      .update({
        status: "ready",
        error_message: null,
        metadata: {
          ...(document.metadata || {}),
          ...metadata,
          upload_pending: false,
          uploaded: document.source_type === "upload" ? true : undefined,
          chunks: chunks.length,
          indexed_server: true,
          extracted_at: new Date().toISOString(),
        },
      })
      .eq("id", document.id)
      .eq("agent_id", agent.id)
      .eq("owner_id", user.id);
    if (updateError) throw new Error("document_update_failed");
    return chunks.length;
  };

  const processLegacyUploadedDocument = async (
    document: Record<string, any>,
    eventType: string,
  ) => {
    try {
      const verified = await verifyStoredUpload(admin, document);
      const extracted = await extractBytes(verified.bytes, verified.name);
      const chunks = await indexLegacyText(
        document,
        extracted.text,
        extracted.metadata,
      );
      await audit(eventType, document.id, {
        name: document.name,
        mime_type: document.mime_type,
        size_bytes: document.size_bytes,
        indexed: true,
        chunks,
        ...extracted.metadata,
      });
      return response({
        documentId: document.id,
        status: "ready",
        indexed: true,
        chunks,
      });
    } catch (error) {
      const code = safeErrorCode(error, "document_extraction_failed");
      await admin
        .from("agent_documents")
        .update({
          status: "error",
          approved_for_ai: false,
          approved_at: null,
          error_message: code,
        })
        .eq("id", document.id)
        .eq("agent_id", agent.id)
        .eq("owner_id", user.id);
      await auditFailure(document.id, code);
      return response(
        { error: code, documentId: document.id, stored: true },
        422,
      );
    }
  };

  if (action === "create_text") {
    const name = cleanName(body.name);
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!name || !content || content.length > MAX_TEXT_CHARS) {
      return response({ error: "invalid_document_text" }, 400);
    }

    try {
      const bytes = new TextEncoder().encode(content);
      const contentSha256 = await sha256Hex(bytes);
      const prepared = await rpc("pro_prepare_text_document", {
        p_agent_id: context.agentId,
        p_actor_user_id: context.actorUserId,
        p_request_id: await scopedRequestId(
          operationId,
          `prepare-text:${context.agentId}`,
        ),
        p_name: name,
        p_content_sha256: contentSha256,
        p_size_bytes: bytes.byteLength,
      });
      if (!prepared?.document_id || !prepared.version_id) {
        throw new Error("document_prepare_incomplete");
      }

      const completed = await runShadowExtraction({
        version: {
          id: String(prepared.version_id),
          source_type: "paste",
          extraction_status: String(prepared.extraction_status || "uploaded"),
        },
        actorUserId: context.actorUserId,
        operationId,
        rpc,
        verifySource: async () => ({ bytes, contentSha256 }),
        extractSource: async () => {
          const chunks = chunkText(content);
          if (!chunks.length) throw new Error("empty_document_text");
          return {
            chunks: chunks.map((chunk, chunkIndex) => ({
              chunk_index: chunkIndex,
              content: chunk,
            })),
            metadata: {
              extraction_parser: "pasted-text",
              extracted_chars: content.length,
            },
          };
        },
      });

      return response({
        documentId: prepared.document_id,
        status: completed.status,
        chunks: completed.chunks,
      });
    } catch (error) {
      const code = safeErrorCode(error, "document_index_failed");
      return response({
        error: code,
        extractionAttemptFinalized: extractionAttemptWasFinalized(error),
      }, documentErrorStatus(code));
    }
  }

  if (action === "prepare_upload") {
    const name = cleanName(body.name);
    const suppliedMime = typeof body.mimeType === "string"
      ? body.mimeType.trim().toLowerCase()
      : "";
    const sizeBytes = Number(body.sizeBytes);
    if (
      !name || !Number.isInteger(sizeBytes) || sizeBytes <= 0 ||
      sizeBytes > MAX_FILE_BYTES || !isAllowedFile(name, suppliedMime)
    ) {
      return response({ error: "invalid_upload" }, 400);
    }
    const mimeType = expectedMimeType(name);
    try {
      const prepared = await rpc("pro_prepare_document_upload", {
        p_agent_id: context.agentId,
        p_actor_user_id: context.actorUserId,
        p_request_id: await scopedRequestId(
          operationId,
          `prepare-upload:${context.agentId}`,
        ),
        p_name: name,
        p_mime_type: mimeType,
        p_size_bytes: sizeBytes,
      });
      if (
        !prepared?.document_id || !prepared.version_id ||
        !prepared.storage_bucket || !prepared.storage_path
      ) {
        throw new Error("document_prepare_incomplete");
      }

      const { data: signed, error: signedError } = await admin.storage
        .from(String(prepared.storage_bucket))
        .createSignedUploadUrl(String(prepared.storage_path), {
          upsert: false,
        });
      if (signedError || !signed?.token) {
        return response({
          error: "signed_upload_failed",
          documentId: prepared.document_id,
          retryable: true,
        }, 500);
      }

      return response({
        documentId: prepared.document_id,
        bucket: prepared.storage_bucket,
        path: prepared.storage_path,
        token: signed.token,
        mimeType,
      });
    } catch (error) {
      const code = safeErrorCode(error, "document_create_failed");
      return response({ error: code }, documentErrorStatus(code));
    }
  }

  if (action === "finalize_upload") {
    const document = await getDocument(body.documentId);
    if (
      !document || document.source_type !== "upload" || !document.storage_path
    ) {
      return response({ error: "document_not_pending" }, 404);
    }

    try {
      const shadowDocument = await getShadowDocument(admin, document.id);
      if (shadowDocument) {
        const result = await processShadowUploadedDocument({
          admin,
          rpc,
          actorUserId: context.actorUserId,
          document,
          shadowDocument,
          operationId,
        });
        return response({ documentId: document.id, ...result });
      }
      if (document.status !== "processing") {
        return response({ error: "document_not_pending" }, 404);
      }
      return await processLegacyUploadedDocument(
        document,
        "document_uploaded_and_extracted",
      );
    } catch (error) {
      const code = safeErrorCode(error, "document_extraction_failed");
      return response(
        {
          error: code,
          documentId: document.id,
          stored: code !== "storage_download_failed" &&
            code !== "storage_path_missing",
          extractionAttemptFinalized: extractionAttemptWasFinalized(error),
        },
        documentErrorStatus(code),
      );
    }
  }

  if (action === "retry_extract") {
    const document = await getDocument(body.documentId);
    if (
      !document || document.source_type !== "upload" ||
      !document.storage_path ||
      !["processing", "uploaded", "error"].includes(document.status)
    ) {
      return response({ error: "document_not_retryable" }, 400);
    }
    try {
      const shadowDocument = await getShadowDocument(admin, document.id);
      if (shadowDocument) {
        const result = await processShadowUploadedDocument({
          admin,
          rpc,
          actorUserId: context.actorUserId,
          document,
          shadowDocument,
          operationId,
        });
        return response({ documentId: document.id, ...result });
      }

      await admin
        .from("agent_documents")
        .update({
          status: "processing",
          error_message: null,
          approved_for_ai: false,
          approved_at: null,
        })
        .eq("id", document.id)
        .eq("agent_id", agent.id)
        .eq("owner_id", user.id);
      return await processLegacyUploadedDocument({
        ...document,
        status: "processing",
      }, "document_extraction_retried");
    } catch (error) {
      const code = safeErrorCode(error, "document_extraction_failed");
      return response(
        {
          error: code,
          documentId: document.id,
          stored: true,
          extractionAttemptFinalized: extractionAttemptWasFinalized(error),
        },
        documentErrorStatus(code),
      );
    }
  }

  if (action === "set_approval") {
    const document = await getDocument(body.documentId);
    const approved = body.approved;
    if (
      !document || document.status !== "ready" || typeof approved !== "boolean"
    ) return response({ error: "document_not_ready" }, 400);

    try {
      const shadowDocument = await getShadowDocument(admin, document.id);
      if (shadowDocument) {
        const version = await getShadowVersion(admin, document, shadowDocument);
        await setShadowApproval({
          documentId: document.id,
          versionId: version.id,
          actorUserId: context.actorUserId,
          approved,
          operationId,
          rpc,
        });
      } else {
        const { error } = await admin
          .from("agent_documents")
          .update({
            approved_for_ai: approved,
            approved_at: approved ? new Date().toISOString() : null,
          })
          .eq("id", document.id)
          .eq("agent_id", agent.id)
          .eq("owner_id", user.id);
        if (error) throw new Error("approval_update_failed");
        await audit(
          approved ? "document_approved_for_ai" : "document_revoked_from_ai",
          document.id,
          { name: document.name },
        );
      }
      return response({ documentId: document.id, approved_for_ai: approved });
    } catch (error) {
      const code = safeErrorCode(error, "approval_update_failed");
      return response({ error: code }, documentErrorStatus(code));
    }
  }

  if (action === "delete") {
    const document = await getDocument(body.documentId);
    if (!document) return response({ error: "document_not_found" }, 404);

    try {
      let shadowDocument = await getShadowDocument(admin, document.id);
      if (!shadowDocument) {
        // Deletion is the sole reconcile-on-demand exception during 1B-B: it
        // guarantees DB neutralization before touching a legacy Storage object.
        await rpc("pro_reconcile_legacy_document", {
          p_document_id: document.id,
          p_request_id: await scopedRequestId(
            operationId,
            `reconcile-delete:${document.id}`,
          ),
        });
        shadowDocument = await getShadowDocument(admin, document.id);
      }
      if (!shadowDocument) throw new Error("shadow_document_not_found");

      const deletion = await runShadowDeletionSaga({
        documentId: document.id,
        actorUserId: context.actorUserId,
        operationId,
        rpc,
        removeObject: async (bucket, path) => {
          const { error } = await admin.storage.from(bucket).remove([path]);
          if (error) {
            const storageError = new Error(
              String(error.message || "storage_delete_failed"),
            ) as Error & Record<string, unknown>;
            Object.assign(storageError, error);
            throw storageError;
          }
        },
      });

      return response({
        deleted: true,
        documentId: document.id,
        storagePending: !deletion.deleted,
      }, deletion.deleted ? 200 : 202);
    } catch (error) {
      const code = safeErrorCode(error, "document_delete_failed");
      return response(
        { error: code, documentId: document.id },
        documentErrorStatus(code),
      );
    }
  }

  return response({ error: "unsupported_action" }, 400);
}

if (import.meta.main) {
  Deno.serve((req) => handleAgentDocumentsRequest(req));
}
