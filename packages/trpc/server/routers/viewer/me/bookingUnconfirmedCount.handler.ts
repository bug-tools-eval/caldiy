import { prisma } from "@calcom/prisma";
import { BookingStatus } from "@calcom/prisma/enums";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

type BookingUnconfirmedCountOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
};

export const bookingUnconfirmedCountHandler = async ({ ctx }: BookingUnconfirmedCountOptions) => {
  const { user } = ctx;
  const now = new Date();
  const [count, recurringGrouping] = await Promise.all([
    prisma.booking.count({
      where: {
        status: BookingStatus.PENDING,
        userId: user.id,
        endTime: { gt: now },
      },
    }),
    prisma.booking.groupBy({
      by: ["recurringEventId"],
      _count: {
        recurringEventId: true,
      },
      where: {
        recurringEventId: { not: { equals: null } },
        status: { equals: "PENDING" },
        userId: user.id,
        endTime: { gt: now },
      },
    }),
  ]);
  return recurringGrouping.reduce((prev, current) => {
    // recurringEventId is the total number of recurring instances for a booking
    // we need to subtract all but one, to represent a single recurring booking
    return prev - (current._count?.recurringEventId - 1);
  }, count);
};
