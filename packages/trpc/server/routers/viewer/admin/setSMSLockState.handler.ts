import { prisma } from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";
import { SMSLockState } from "@calcom/prisma/enums";
import { TRPCError } from "@trpc/server";
import type { TrpcSessionUser } from "../../../types";
import type { TSetSMSLockState } from "./setSMSLockState.schema";

type GetOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
  input: TSetSMSLockState;
};

const isRecordNotFoundError = (error: unknown) => {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
};

const setSMSLockState = async ({ input }: GetOptions) => {
  const { userId, username, teamId, teamSlug, lock } = input;
  const smsLockState = lock ? SMSLockState.LOCKED : SMSLockState.UNLOCKED;

  if (userId) {
    try {
      const updatedUser = await prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          smsLockState,
          smsLockReviewedByAdmin: true,
        },
        select: {
          username: true,
        },
      });
      return { name: updatedUser.username, locked: lock };
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "User not found" });
      }
      throw error;
    }
  } else if (username) {
    const userToUpdate = await prisma.user.findFirst({
      where: {
        username,
        profiles: { none: {} },
      },
      select: {
        id: true,
      },
    });
    if (!userToUpdate) throw new TRPCError({ code: "BAD_REQUEST", message: "User not found" });
    const updatedUser = await prisma.user.update({
      where: {
        id: userToUpdate.id,
      },
      data: {
        smsLockState,
        smsLockReviewedByAdmin: true,
      },
      select: {
        username: true,
      },
    });
    return { name: updatedUser.username, locked: lock };
  } else if (teamId) {
    try {
      const updatedTeam = await prisma.team.update({
        where: {
          id: teamId,
        },
        data: {
          smsLockState,
          smsLockReviewedByAdmin: true,
        },
        select: {
          slug: true,
        },
      });
      return { name: updatedTeam.slug, locked: lock };
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Team not found" });
      }
      throw error;
    }
  } else if (teamSlug) {
    const teamToUpdate = await prisma.team.findFirst({
      where: {
        slug: teamSlug,
        parentId: null,
      },
      select: {
        id: true,
      },
    });
    if (!teamToUpdate) throw new TRPCError({ code: "BAD_REQUEST", message: "Team not found" });
    const updatedTeam = await prisma.team.update({
      where: {
        id: teamToUpdate.id,
      },
      data: {
        smsLockState,
        smsLockReviewedByAdmin: true,
      },
      select: {
        slug: true,
      },
    });
    return { name: updatedTeam.slug, locked: lock };
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: "Input data missing" });
};

export default setSMSLockState;
