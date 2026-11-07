import { ok, type RouteCtx } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { audit } from "@/server/modules/audit/audit";
import { retryJob } from "@/server/platform/jobs/queue";

/** Gives a dead or failed background job a fresh set of attempts. */
export const POST = adminRoute<RouteCtx<{ id: string }>>(
  "JOBS_MANAGE",
  async (_req, { params }, { actor }) => {
    const { id } = await params;
    if (!(await retryJob(id)))
      throw new AppError("INVALID_STATE", "Only failed or dead jobs can be retried");
    await audit({
      actorId: actor.id,
      action: "job.retry",
      entityType: "Job",
      entityId: id,
      ipAddress: actor.ip,
    });
    return ok({ retried: true });
  },
);
