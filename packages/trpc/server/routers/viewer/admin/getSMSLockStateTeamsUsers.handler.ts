import { prisma } from "@calcom/prisma";
import { SMSLockState } from "@calcom/prisma/enums";
import type { TrpcSessionUser } from "../../../types";

type GetOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
};

const getSMSLockStateTeamsUsers = async (_opts: GetOptions) => {
  const userSelect = {
    id: true,
    smsLockState: true,
    email: true,
    username: true,
    name: true,
    avatarUrl: true,
  };

  const teamSelect = {
    id: true,
    smsLockState: true,
    slug: true,
    name: true,
    logoUrl: true,
  };

  const smsLockStatesToReview = [SMSLockState.LOCKED, SMSLockState.REVIEW_NEEDED];

  const [users, teams] = await Promise.all([
    prisma.user.findMany({
      where: {
        smsLockState: {
          in: smsLockStatesToReview,
        },
      },
      select: userSelect,
    }),
    prisma.team.findMany({
      where: {
        smsLockState: {
          in: smsLockStatesToReview,
        },
      },
      select: teamSelect,
    }),
  ]);

  const resultObj = {
    users: {
      locked: users.filter((user) => user.smsLockState === SMSLockState.LOCKED),
      reviewNeeded: users.filter((user) => user.smsLockState === SMSLockState.REVIEW_NEEDED),
    },
    teams: {
      locked: teams.filter((team) => team.smsLockState === SMSLockState.LOCKED),
      reviewNeeded: teams.filter((team) => team.smsLockState === SMSLockState.REVIEW_NEEDED),
    },
  };

  return resultObj;
};

export default getSMSLockStateTeamsUsers;
