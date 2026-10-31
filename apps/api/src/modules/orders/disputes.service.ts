import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@accordo/db';
import {
  type DisputeAction,
  DisputeActionError,
  type DisputeReason,
  disputeOpeningError,
  OrderTransitionError,
} from '@accordo/domain';
import {
  type Actor,
  applyDisputeAction,
  applyOrderEvent,
  OrderConflictError,
} from '@accordo/orders';
import type { DisputeAvailableAction, DisputeDetail } from '@accordo/shared';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { PRISMA, S3 } from '../platform/infra.providers.js';

const OPEN = ['OPEN', 'AWAITING_BUYER', 'UNDER_REVIEW', 'AWAITING_RETURN'];
const APPEAL_MS = 7 * 86_400_000;

function rethrow(e: unknown): never {
  if (e instanceof DisputeActionError)
    throw e.code === 'NOT_ALLOWED'
      ? new ForbiddenException({ code: 'NOT_ALLOWED' })
      : new ConflictException({ code: e.code });
  if (e instanceof OrderTransitionError)
    throw new ConflictException({ code: 'DISPUTE_NOT_ALLOWED', detail: e.message });
  if (e instanceof OrderConflictError) throw new ConflictException({ code: 'ORDER_CHANGED' });
  throw e;
}

/** SPEC §6.6: opening, thread, evidence in the private bucket and the parties' actions. */
@Injectable()
export class DisputesService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(S3) private readonly s3: S3Client,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Moves uploaded photos out of the temporary area, owned by the uploader only. */
  private async storeEvidence(userId: string, disputeId: string, keys: string[]) {
    const stored: Array<{ storageKey: string; mimeType: string }> = [];
    for (const key of keys) {
      if (!key.startsWith(`uploads/tmp/${userId}/`))
        throw new BadRequestException({ code: 'INVALID_UPLOAD_KEY' });
      const Bucket = this.env.S3_BUCKET_PRIVATE;
      const head = await this.s3.send(new HeadObjectCommand({ Bucket, Key: key })).catch(() => {
        throw new BadRequestException({ code: 'UPLOAD_NOT_FOUND' });
      });
      const storageKey = `disputes/${disputeId}/${randomUUID()}`;
      await this.s3.send(
        new CopyObjectCommand({ Bucket, Key: storageKey, CopySource: `${Bucket}/${key}` }),
      );
      await this.s3.send(new DeleteObjectCommand({ Bucket, Key: key })).catch(() => undefined);
      stored.push({ storageKey, mimeType: head.ContentType ?? 'application/octet-stream' });
    }
    return stored;
  }

  async open(
    userId: string,
    orderId: string,
    input: { reason: DisputeReason; description: string; evidenceKeys: string[] },
  ) {
    const order = await this.db.order.findFirst({ where: { id: orderId, buyerId: userId } });
    if (!order) throw new NotFoundException();
    const error = disputeOpeningError({
      reason: input.reason,
      description: input.description,
      photos: input.evidenceKeys.length,
    });
    if (error) throw new UnprocessableEntityException({ code: error });
    if (await this.db.dispute.findUnique({ where: { orderId } }))
      throw new ConflictException({ code: 'DISPUTE_EXISTS' });

    const id = randomUUID();
    const evidence = await this.storeEvidence(userId, id, input.evidenceKeys);
    try {
      await this.db.$transaction(async (tx) => {
        const { order: updated } = await applyOrderEvent(
          tx,
          orderId,
          { type: 'DISPUTE_OPENED', reason: input.reason },
          { role: 'BUYER', id: userId },
          { handoverPepper: this.env.HANDOVER_CODE_PEPPER },
        );
        await tx.dispute.create({
          data: {
            id,
            orderId,
            openedById: userId,
            reason: input.reason,
            description: input.description,
            sellerResponseDueAt: updated.nextActionAt,
            evidence: { create: evidence.map((e) => ({ ...e, uploadedById: userId })) },
          },
        });
      });
    } catch (e) {
      rethrow(e);
    }
    return this.detail(userId, id);
  }

  private async load(userId: string, id: string, staff: boolean) {
    const d = await this.db.dispute.findFirst({
      where: {
        id,
        ...(staff ? {} : { order: { OR: [{ buyerId: userId }, { sellerId: userId }] } }),
      },
      include: {
        order: true,
        messages: { orderBy: { createdAt: 'asc' } },
        evidence: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!d) throw new NotFoundException();
    return d;
  }

  async detail(userId: string, id: string, staff = false): Promise<DisputeDetail> {
    const d = await this.load(userId, id, staff);
    const o = d.order;
    const role = staff ? 'SUPPORT' : o.buyerId === userId ? 'BUYER' : 'SELLER';
    const returned = await this.db.shipment.count({
      where: { orderId: o.id, direction: 'RETURN', status: 'DELIVERED' },
    });
    const actions: DisputeAvailableAction[] = [];
    if (OPEN.includes(d.status)) actions.push('message', 'addEvidence');
    if (role === 'SELLER' && d.status === 'OPEN') actions.push('respond');
    if (role === 'BUYER' && d.status === 'AWAITING_BUYER') actions.push('acceptProposal');
    if (
      (role !== 'SUPPORT' && (d.status === 'OPEN' || d.status === 'AWAITING_BUYER')) ||
      (role === 'SELLER' && d.status === 'AWAITING_RETURN' && returned > 0)
    )
      actions.push('escalate');
    if (role === 'BUYER' && ['OPEN', 'AWAITING_BUYER', 'UNDER_REVIEW'].includes(d.status))
      actions.push('withdraw');
    if (
      role !== 'SUPPORT' &&
      d.status === 'RESOLVED' &&
      !d.appealedAt &&
      d.resolvedById &&
      d.resolvedAt &&
      Date.now() - d.resolvedAt.getTime() <= APPEAL_MS
    )
      actions.push('appeal');
    const roleOf = (authorId: string) =>
      authorId === o.buyerId ? 'BUYER' : authorId === o.sellerId ? 'SELLER' : 'SUPPORT';
    return {
      id: d.id,
      orderId: o.id,
      orderNumber: o.number,
      orderStatus: o.status,
      itemPriceCents: o.itemPriceCents,
      totalCents: o.totalCents,
      role,
      reason: d.reason,
      description: d.description,
      status: d.status,
      outcome: d.outcome,
      proposedRefundCents: d.proposedRefundCents,
      resolvedRefundCents: d.resolvedRefundCents,
      resolutionNotes: d.resolutionNotes,
      sellerAtFault: d.sellerAtFault,
      sellerResponseDueAt: d.sellerResponseDueAt?.toISOString() ?? null,
      buyerResponseDueAt: d.buyerResponseDueAt?.toISOString() ?? null,
      resolvedAt: d.resolvedAt?.toISOString() ?? null,
      appealedAt: d.appealedAt?.toISOString() ?? null,
      appealResolvedAt: d.appealResolvedAt?.toISOString() ?? null,
      appealUpheld: d.appealUpheld,
      appealNotes: d.appealNotes,
      messages: d.messages.map((m) => ({
        id: m.id,
        authorRole: m.authorRole,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      })),
      evidence: d.evidence.map((e) => ({
        id: e.id,
        uploadedByRole: roleOf(e.uploadedById),
        createdAt: e.createdAt.toISOString(),
      })),
      actions,
      createdAt: d.createdAt.toISOString(),
    };
  }

  async evidenceFile(userId: string, id: string, evidenceId: string, staff = false) {
    const d = await this.load(userId, id, staff);
    const e = d.evidence.find((x) => x.id === evidenceId);
    if (!e) throw new NotFoundException();
    const object = await this.s3.send(
      new GetObjectCommand({ Bucket: this.env.S3_BUCKET_PRIVATE, Key: e.storageKey }),
    );
    const body = await (
      object.Body as { transformToByteArray(): Promise<Uint8Array> }
    ).transformToByteArray();
    return { body: Buffer.from(body), mimeType: e.mimeType };
  }

  async message(userId: string, id: string, body: string, staff = false) {
    const d = await this.load(userId, id, staff);
    if (!OPEN.includes(d.status)) throw new ConflictException({ code: 'DISPUTE_CLOSED' });
    await this.db.disputeMessage.create({
      data: {
        disputeId: d.id,
        authorId: userId,
        authorRole: staff ? 'SUPPORT' : d.order.buyerId === userId ? 'BUYER' : 'SELLER',
        body,
      },
    });
    return this.detail(userId, id, staff);
  }

  async addEvidence(userId: string, id: string, keys: string[]) {
    const d = await this.load(userId, id, false);
    if (!OPEN.includes(d.status)) throw new ConflictException({ code: 'DISPUTE_CLOSED' });
    const stored = await this.storeEvidence(userId, d.id, keys);
    await this.db.disputeEvidence.createMany({
      data: stored.map((s) => ({ ...s, disputeId: d.id, uploadedById: userId })),
    });
    return this.detail(userId, id);
  }

  /** A party's or the staff's action through the shared dispute engine. */
  async act(
    userId: string,
    id: string,
    action: DisputeAction,
    opts: { message?: string; notes?: string; staff?: boolean } = {},
  ) {
    const d = await this.load(userId, id, !!opts.staff);
    const actor: Actor = {
      role: opts.staff ? 'SUPPORT' : d.order.buyerId === userId ? 'BUYER' : 'SELLER',
      id: userId,
    };
    try {
      await this.db.$transaction((tx) =>
        applyDisputeAction(tx, d.id, action, actor, {
          handoverPepper: this.env.HANDOVER_CODE_PEPPER,
          message: opts.message,
          notes: opts.notes,
        }),
      );
    } catch (e) {
      rethrow(e);
    }
    return this.detail(userId, id, !!opts.staff);
  }

  async adminList(status?: string) {
    const rows = await this.db.dispute.findMany({
      where: status ? { status: status as never } : {},
      include: { order: { select: { number: true, totalCents: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return rows.map((d) => ({
      id: d.id,
      orderNumber: d.order.number,
      totalCents: d.order.totalCents,
      reason: d.reason,
      status: d.status,
      escalatedAt: d.escalatedAt?.toISOString() ?? null,
      appealPending: !!d.appealedAt && !d.appealResolvedAt,
      createdAt: d.createdAt.toISOString(),
    }));
  }
}
