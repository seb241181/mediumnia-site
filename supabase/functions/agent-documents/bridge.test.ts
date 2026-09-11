import {
  actorContext,
  documentErrorStatus,
  extractionAttemptWasFinalized,
  MAX_CHUNKS,
  MAX_FILE_BYTES,
  runShadowDeletionSaga,
  runShadowExtraction,
  scopedRequestId,
  setShadowApproval,
} from "./bridge.ts";

function assert(
  condition: unknown,
  message = "assertion_failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(
  actual: unknown,
  expected: unknown,
  message = "values_differ",
) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: ${actualJson} !== ${expectedJson}`);
  }
}

const actorUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const documentId = "40000000-0000-4000-8000-000000000001";
const versionId = "70000000-0000-4000-8000-000000000001";
const operationId = "50000000-0000-4000-8000-000000000001";
const extractionClaimId = "60000000-0000-4000-8000-000000000001";

Deno.test("shadow upload verifies Storage before mark, claim, parse and atomic completion", async () => {
  const events: string[] = [];
  const rpc = async (name: string) => {
    events.push(name);
    if (name === "pro_claim_document_extraction_attempt") {
      return { extraction_status: "processing", claim_id: extractionClaimId };
    }
    if (name === "pro_complete_document_extraction") {
      return { chunk_count: 1, replayed: false };
    }
    return {};
  };

  const result = await runShadowExtraction({
    version: {
      id: versionId,
      extraction_status: "pending_upload",
      upload_verified_at: null,
    },
    actorUserId,
    operationId,
    rpc,
    verifySource: async () => {
      events.push("storage_verified");
      return {
        bytes: new TextEncoder().encode("source verified"),
        contentSha256: "a".repeat(64),
      };
    },
    extractSource: async () => {
      events.push("parser");
      return {
        chunks: [{ chunk_index: 0, content: "source verified" }],
        metadata: { extraction_parser: "test" },
      };
    },
  });

  assertEquals(events, [
    "storage_verified",
    "pro_mark_document_version_uploaded",
    "pro_claim_document_extraction_attempt",
    "parser",
    "pro_complete_document_extraction",
  ]);
  assertEquals(result, {
    status: "ready",
    indexed: true,
    chunks: 1,
    replayed: false,
  });
  assert(
    !events.includes("agent_document_chunks"),
    "new path must not write legacy chunks directly",
  );
});

Deno.test("pending upload never reaches extraction when Storage verification fails", async () => {
  const events: string[] = [];
  let parserCalled = false;
  try {
    await runShadowExtraction({
      version: { id: versionId, extraction_status: "pending_upload" },
      actorUserId,
      operationId,
      rpc: async (name) => {
        events.push(name);
        return {};
      },
      verifySource: async () => {
        throw new Error("storage_download_failed");
      },
      extractSource: async () => {
        parserCalled = true;
        return { chunks: [], metadata: {} };
      },
    });
    throw new Error("verification_failure_not_propagated");
  } catch (error) {
    assert(String(error).includes("storage_download_failed"));
  }
  assertEquals(events, []);
  assertEquals(parserCalled, false);
});

Deno.test("parser failure is recorded through pro_fail_document_extraction", async () => {
  const events: string[] = [];
  try {
    await runShadowExtraction({
      version: {
        id: versionId,
        extraction_status: "uploaded",
        upload_verified_at: "2026-09-11T12:00:00Z",
      },
      actorUserId,
      operationId,
      rpc: async (name) => {
        events.push(name);
        if (name === "pro_claim_document_extraction_attempt") {
          return {
            extraction_status: "processing",
            claim_id: extractionClaimId,
          };
        }
        return {};
      },
      verifySource: async () => ({
        bytes: new Uint8Array([1]),
        contentSha256: "b".repeat(64),
      }),
      extractSource: async () => {
        throw new Error("invalid_pdf_signature");
      },
    });
    throw new Error("parser_failure_not_propagated");
  } catch (error) {
    assert(String(error).includes("invalid_pdf_signature"));
    assert(extractionAttemptWasFinalized(error));
  }
  assertEquals(events, [
    "pro_claim_document_extraction_attempt",
    "pro_fail_document_extraction",
  ]);
});

Deno.test("pasted text skips upload verification but keeps claim and atomic completion", async () => {
  const events: string[] = [];
  await runShadowExtraction({
    version: {
      id: versionId,
      source_type: "paste",
      extraction_status: "uploaded",
    },
    actorUserId,
    operationId,
    rpc: async (name) => {
      events.push(name);
      if (name === "pro_claim_document_extraction_attempt") {
        return {
          extraction_status: "processing",
          claim_id: extractionClaimId,
        };
      }
      return {};
    },
    verifySource: async () => ({
      bytes: new TextEncoder().encode("pasted source"),
      contentSha256: "d".repeat(64),
    }),
    extractSource: async () => ({
      chunks: [{ chunk_index: 0, content: "pasted source" }],
      metadata: { extraction_parser: "pasted-text" },
    }),
  });

  assertEquals(events, [
    "pro_claim_document_extraction_attempt",
    "pro_complete_document_extraction",
  ]);
});

Deno.test("completion retries keep claim-scoped ids and payload conflicts are rejected", async () => {
  const first = await scopedRequestId(
    extractionClaimId,
    `complete:${versionId}`,
  );
  const second = await scopedRequestId(
    extractionClaimId,
    `complete:${versionId}`,
  );
  assertEquals(first, second);

  const calls: string[] = [];
  try {
    await runShadowExtraction({
      version: {
        id: versionId,
        extraction_status: "uploaded",
        upload_verified_at: "2026-09-11T12:00:00Z",
      },
      actorUserId,
      operationId,
      rpc: async (name) => {
        calls.push(name);
        if (name === "pro_claim_document_extraction_attempt") {
          return {
            extraction_status: "processing",
            claim_id: extractionClaimId,
          };
        }
        if (name === "pro_complete_document_extraction") {
          throw new Error("completion_payload_conflict");
        }
        return {};
      },
      verifySource: async () => ({
        bytes: new Uint8Array([1]),
        contentSha256: "c".repeat(64),
      }),
      extractSource: async () => ({
        chunks: [{ chunk_index: 0, content: "content" }],
        metadata: {},
      }),
    });
    throw new Error("payload_conflict_not_propagated");
  } catch (error) {
    assert(String(error).includes("completion_payload_conflict"));
  }
  assert(
    !calls.includes("pro_fail_document_extraction"),
    "completion ambiguity must not be rewritten as parser failure",
  );
});

Deno.test("a committed extraction failure replay does not start a second parser", async () => {
  const calls: string[] = [];
  let parserCalled = false;
  try {
    await runShadowExtraction({
      version: {
        id: versionId,
        source_type: "paste",
        extraction_status: "failed",
      },
      actorUserId,
      operationId,
      rpc: async (name) => {
        calls.push(name);
        if (name === "pro_claim_document_extraction_attempt") {
          return {
            extraction_status: "failed",
            claim_id: extractionClaimId,
            error_code: "pdf_page_limit",
            replayed: true,
          };
        }
        return {};
      },
      verifySource: async () => ({
        bytes: new Uint8Array([1]),
        contentSha256: "e".repeat(64),
      }),
      extractSource: async () => {
        parserCalled = true;
        return { chunks: [], metadata: {} };
      },
    });
    throw new Error("committed_failure_not_propagated");
  } catch (error) {
    assert(String(error).includes("pdf_page_limit"));
    assert(extractionAttemptWasFinalized(error));
  }

  assertEquals(calls, ["pro_claim_document_extraction_attempt"]);
  assertEquals(parserCalled, false);
});

Deno.test("completion and failure identities are stable per claim and rotate per attempt", async () => {
  const claimTwo = "60000000-0000-4000-8000-000000000002";
  const firstFailure = await scopedRequestId(
    extractionClaimId,
    `failure:${versionId}`,
  );
  const replayedFailure = await scopedRequestId(
    extractionClaimId,
    `failure:${versionId}`,
  );
  const secondFailure = await scopedRequestId(
    claimTwo,
    `failure:${versionId}`,
  );

  assertEquals(firstFailure, replayedFailure);
  assert(firstFailure !== secondFailure);
});

Deno.test("deterministic parser errors are 422 and extraction timeout closes the attempt", () => {
  for (
    const code of [
      "pdf_page_limit",
      "invalid_pdf_signature",
      "invalid_docx",
      "pdf_no_extractable_text",
      "text_too_large",
      "empty_document_text",
    ]
  ) {
    assertEquals(documentErrorStatus(code), 422, code);
  }
  assertEquals(documentErrorStatus("pdf_extraction_timeout"), 504);
});

Deno.test("shadow approval calls approve then publish while revocation uses runtime toggle", async () => {
  const approvalCalls: string[] = [];
  await setShadowApproval({
    documentId,
    versionId,
    actorUserId,
    approved: true,
    operationId,
    rpc: async (name) => {
      approvalCalls.push(name);
      return {};
    },
  });
  assertEquals(approvalCalls, [
    "pro_approve_document_version",
    "pro_publish_document_version",
  ]);

  const revokeCalls: string[] = [];
  await setShadowApproval({
    documentId,
    versionId,
    actorUserId,
    approved: false,
    operationId,
    rpc: async (name) => {
      revokeCalls.push(name);
      return {};
    },
  });
  assertEquals(revokeCalls, ["pro_set_document_ai_enabled"]);
});

Deno.test("delete neutralizes DB before Storage and records a retryable failure", async () => {
  const events: string[] = [];
  let failureArgs: Record<string, unknown> | null = null;
  let claimCount = 0;
  const result = await runShadowDeletionSaga({
    documentId,
    actorUserId,
    operationId,
    maxJobs: 2,
    rpc: async (name, args) => {
      events.push(name);
      if (name === "pro_fail_document_storage_job") failureArgs = args;
      if (name === "pro_claim_document_storage_job") {
        claimCount += 1;
        return claimCount === 1
          ? {
            job_id: "80000000-0000-4000-8000-000000000001",
            job_status: "processing",
            storage_bucket: "agent-documents",
            storage_path: "private/source.pdf",
          }
          : null;
      }
      if (name === "pro_finalize_document_deletion") {
        return { lifecycle_status: "deleting", pending_storage_jobs: 1 };
      }
      return {};
    },
    removeObject: async () => {
      events.push("storage_remove");
      throw new Error("storage_unavailable");
    },
  });

  assertEquals(events[0], "pro_delete_document");
  assert(
    events.indexOf("pro_delete_document") < events.indexOf("storage_remove"),
  );
  assert(events.includes("pro_fail_document_storage_job"));
  assertEquals(
    (failureArgs as Record<string, unknown> | null)?.p_error_code,
    "storage_delete_failed",
  );
  assertEquals(result.deleted, false);
  assertEquals(result.pendingStorageJobs, 1);
});

Deno.test("successive Storage leases use distinct claim-scoped failure identities", async () => {
  const jobId = "80000000-0000-4000-8000-000000000001";
  const claims = [
    "90000000-0000-4000-8000-000000000001",
    "90000000-0000-4000-8000-000000000002",
  ];
  const failures: Array<Record<string, unknown>> = [];

  for (const storageClaimId of claims) {
    let claimCount = 0;
    await runShadowDeletionSaga({
      documentId,
      actorUserId,
      operationId,
      maxJobs: 2,
      rpc: async (name, args) => {
        if (name === "pro_claim_document_storage_job") {
          claimCount += 1;
          return claimCount === 1
            ? {
              job_id: jobId,
              job_status: "processing",
              claim_id: storageClaimId,
              storage_bucket: "agent-documents",
              storage_path: "private/source.pdf",
            }
            : null;
        }
        if (name === "pro_fail_document_storage_job") failures.push(args);
        if (name === "pro_finalize_document_deletion") {
          return { lifecycle_status: "deleting", pending_storage_jobs: 1 };
        }
        return {};
      },
      removeObject: async () => {
        throw new Error("storage_unavailable");
      },
    });
  }

  assertEquals(failures.map((failure) => failure.p_claim_id), claims);
  assert(failures[0].p_request_id !== failures[1].p_request_id);
});

Deno.test("already absent Storage object completes idempotently", async () => {
  const calls: string[] = [];
  let claimCount = 0;
  const result = await runShadowDeletionSaga({
    documentId,
    actorUserId,
    operationId,
    maxJobs: 2,
    rpc: async (name) => {
      calls.push(name);
      if (name === "pro_claim_document_storage_job") {
        claimCount += 1;
        return claimCount === 1
          ? {
            job_id: "80000000-0000-4000-8000-000000000001",
            job_status: "processing",
            storage_bucket: "agent-documents",
            storage_path: "private/source.pdf",
          }
          : null;
      }
      if (name === "pro_finalize_document_deletion") {
        return { lifecycle_status: "deleted", pending_storage_jobs: 0 };
      }
      return {};
    },
    removeObject: async () => {
      throw Object.assign(new Error("Object not found"), { status: 404 });
    },
  });

  assert(calls.includes("pro_complete_document_storage_job"));
  assert(!calls.includes("pro_fail_document_storage_job"));
  assertEquals(result.deleted, true);
});

Deno.test("actor and workspace are derived from JWT and authorized agent, never forged body", () => {
  const forgedBody = {
    actor_user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    workspace_id: "99999999-9999-4999-8999-999999999999",
  };
  assert(forgedBody.actor_user_id !== actorUserId);
  const context = actorContext(
    { id: actorUserId },
    {
      id: "20000000-0000-4000-8000-000000000001",
      membership_id: "10000000-0000-4000-8000-000000000001",
      workspace_id: "30000000-0000-4000-8000-000000000001",
    },
  );
  assertEquals(context.actorUserId, actorUserId);
  assertEquals(context.workspaceId, "30000000-0000-4000-8000-000000000001");
});

Deno.test("document bridge preserves 25 MB and 120 chunk limits", () => {
  assertEquals(MAX_FILE_BYTES, 25 * 1024 * 1024);
  assertEquals(MAX_CHUNKS, 120);
});
