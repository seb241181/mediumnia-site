export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_CHUNKS = 120;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RpcResult = Record<string, unknown>;
export type RpcCaller = (
  name: string,
  args: Record<string, unknown>,
) => Promise<RpcResult | null>;

export interface ShadowVersion {
  id: string;
  source_type?: string;
  extraction_status: string;
  upload_verified_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface VerifiedSource {
  bytes: Uint8Array;
  contentSha256: string;
}

export interface ExtractedSource {
  chunks: Array<{ chunk_index: number; content: string }>;
  metadata: Record<string, unknown>;
}

function bytesToUuid(bytes: Uint8Array) {
  const hex = Array.from(
    bytes.slice(0, 16),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20, 32)}`;
}

export function clientRequestId(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : crypto.randomUUID();
}

export async function scopedRequestId(operationId: string, scope: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        `mediumia:agent-documents:${operationId}:${scope}`,
      ),
    ),
  );
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  return bytesToUuid(digest);
}

export async function sha256Hex(bytes: Uint8Array) {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", input.buffer),
  );
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function safeErrorCode(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : String(error || "");
  const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_")
    .slice(0, 160);
  return normalized || fallback;
}

export function actorContext(
  user: { id: string },
  agent: { id: string; workspace_id?: string | null; membership_id: string },
) {
  return {
    actorUserId: user.id,
    agentId: agent.id,
    membershipId: agent.membership_id,
    workspaceId: agent.workspace_id || null,
  };
}

export async function runShadowExtraction({
  version,
  actorUserId,
  operationId,
  rpc,
  verifySource,
  extractSource,
}: {
  version: ShadowVersion;
  actorUserId: string;
  operationId: string;
  rpc: RpcCaller;
  verifySource: () => Promise<VerifiedSource>;
  extractSource: (bytes: Uint8Array) => Promise<ExtractedSource>;
}) {
  if (version.extraction_status === "ready") {
    return {
      status: "ready",
      indexed: true,
      chunks: Number(version.metadata?.chunks || 0),
      replayed: true,
    };
  }

  // Storage must be read and validated before PostgreSQL can leave pending_upload.
  const verified = await verifySource();
  const markRequestId = await scopedRequestId(
    operationId,
    `mark:${version.id}`,
  );
  const claimId = await scopedRequestId(operationId, `claim:${version.id}`);
  const claimRequestId = await scopedRequestId(
    operationId,
    `claim-request:${version.id}`,
  );

  if (
    (version.source_type || "upload") === "upload" &&
    (!version.upload_verified_at ||
      ["pending_upload", "failed"].includes(version.extraction_status))
  ) {
    await rpc("pro_mark_document_version_uploaded", {
      p_version_id: version.id,
      p_actor_user_id: actorUserId,
      p_request_id: markRequestId,
    });
  }

  const claim = await rpc("pro_claim_document_extraction", {
    p_version_id: version.id,
    p_actor_user_id: actorUserId,
    p_claim_id: claimId,
    p_request_id: claimRequestId,
    p_lease_seconds: 300,
  });

  if (claim?.extraction_status === "ready") {
    return {
      status: "ready",
      indexed: true,
      chunks: Number(version.metadata?.chunks || 0),
      replayed: true,
    };
  }

  let extracted: ExtractedSource;
  try {
    extracted = await extractSource(verified.bytes);
  } catch (error) {
    const code = safeErrorCode(error, "document_extraction_failed");
    const failureRequestId = await scopedRequestId(
      operationId,
      `failure:${version.id}`,
    );
    await rpc("pro_fail_document_extraction", {
      p_version_id: version.id,
      p_actor_user_id: actorUserId,
      p_claim_id: claimId,
      p_request_id: failureRequestId,
      p_error_code: code,
    });
    throw error;
  }

  const completionRequestId = await scopedRequestId(
    operationId,
    `complete:${version.id}`,
  );
  const completed = await rpc("pro_complete_document_extraction", {
    p_version_id: version.id,
    p_actor_user_id: actorUserId,
    p_claim_id: claimId,
    p_request_id: completionRequestId,
    p_content_sha256: verified.contentSha256,
    p_chunks: extracted.chunks,
    p_extraction_metadata: {
      ...extracted.metadata,
      chunks: extracted.chunks.length,
    },
  });

  return {
    status: "ready",
    indexed: true,
    chunks: Number(completed?.chunk_count || extracted.chunks.length),
    replayed: Boolean(completed?.replayed),
  };
}

export async function setShadowApproval({
  documentId,
  versionId,
  actorUserId,
  approved,
  operationId,
  rpc,
}: {
  documentId: string;
  versionId: string;
  actorUserId: string;
  approved: boolean;
  operationId: string;
  rpc: RpcCaller;
}) {
  if (!approved) {
    return await rpc("pro_set_document_ai_enabled", {
      p_document_id: documentId,
      p_actor_user_id: actorUserId,
      p_enabled: false,
      p_request_id: await scopedRequestId(operationId, `disable:${documentId}`),
    });
  }

  await rpc("pro_approve_document_version", {
    p_version_id: versionId,
    p_actor_user_id: actorUserId,
    p_request_id: await scopedRequestId(operationId, `approve:${versionId}`),
  });
  return await rpc("pro_publish_document_version", {
    p_version_id: versionId,
    p_actor_user_id: actorUserId,
    p_request_id: await scopedRequestId(operationId, `publish:${versionId}`),
  });
}

function storageObjectAlreadyAbsent(error: unknown) {
  const candidate = error as {
    status?: number;
    statusCode?: number;
    code?: string;
    message?: string;
  } | null;
  const status = Number(candidate?.status || candidate?.statusCode);
  const code = String(candidate?.code || candidate?.message || "")
    .toLowerCase();
  return status === 404 || code.includes("not_found") ||
    code.includes("not found") || code.includes("does not exist");
}

export async function runShadowDeletionSaga({
  documentId,
  actorUserId,
  operationId,
  rpc,
  removeObject,
  maxJobs = 120,
}: {
  documentId: string;
  actorUserId: string;
  operationId: string;
  rpc: RpcCaller;
  removeObject: (bucket: string, path: string) => Promise<void>;
  maxJobs?: number;
}) {
  // Access is neutralized transactionally before any external Storage call.
  await rpc("pro_delete_document", {
    p_document_id: documentId,
    p_actor_user_id: actorUserId,
    p_request_id: await scopedRequestId(operationId, `delete-db:${documentId}`),
  });

  let failures = 0;
  let processed = 0;
  for (let index = 0; index < maxJobs; index += 1) {
    const claimId = await scopedRequestId(
      operationId,
      `storage-claim:${documentId}:${index}`,
    );
    const job = await rpc("pro_claim_document_storage_job", {
      p_document_id: documentId,
      p_actor_user_id: actorUserId,
      p_claim_id: claimId,
      p_request_id: await scopedRequestId(
        operationId,
        `storage-claim-request:${documentId}:${index}`,
      ),
      p_lease_seconds: 120,
    });
    if (!job?.job_id) break;
    if (job.job_status === "completed") continue;
    if (job.job_status !== "processing") {
      failures += 1;
      continue;
    }

    try {
      await removeObject(String(job.storage_bucket), String(job.storage_path));
      await rpc("pro_complete_document_storage_job", {
        p_job_id: job.job_id,
        p_actor_user_id: actorUserId,
        p_claim_id: claimId,
        p_request_id: await scopedRequestId(
          operationId,
          `storage-complete:${job.job_id}`,
        ),
      });
      processed += 1;
    } catch (error) {
      if (storageObjectAlreadyAbsent(error)) {
        await rpc("pro_complete_document_storage_job", {
          p_job_id: job.job_id,
          p_actor_user_id: actorUserId,
          p_claim_id: claimId,
          p_request_id: await scopedRequestId(
            operationId,
            `storage-complete:${job.job_id}`,
          ),
        });
        processed += 1;
        continue;
      }

      failures += 1;
      await rpc("pro_fail_document_storage_job", {
        p_job_id: job.job_id,
        p_actor_user_id: actorUserId,
        p_claim_id: claimId,
        p_request_id: await scopedRequestId(
          operationId,
          `storage-failure:${job.job_id}`,
        ),
        p_error_code: "storage_delete_failed",
        p_retry_seconds: 60,
      });
    }
  }

  const finalized = await rpc("pro_finalize_document_deletion", {
    p_document_id: documentId,
    p_actor_user_id: actorUserId,
    p_request_id: await scopedRequestId(
      operationId,
      `delete-finalize:${documentId}`,
    ),
  });

  return {
    deleted: finalized?.lifecycle_status === "deleted",
    pendingStorageJobs: Number(finalized?.pending_storage_jobs || 0),
    processed,
    failures,
  };
}
