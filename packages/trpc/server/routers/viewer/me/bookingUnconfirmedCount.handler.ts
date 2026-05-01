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
  const bookingGroups = await prisma.booking.groupBy({
    by: ["recurringEventId"],
    _count: {
      _all: true,
    },
    where: {
      status: BookingStatus.PENDING,
      userId: user.id,
      endTime: { gt: now },
    },
  });

  return bookingGroups.reduce((count, group) => {
    return count + (group.recurringEventId === null ? group._count._all : 1);
  }, 0);
};
