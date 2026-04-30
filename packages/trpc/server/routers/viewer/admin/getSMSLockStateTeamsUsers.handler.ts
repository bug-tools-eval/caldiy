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

  const lockedUsers: typeof users = [];
  const reviewNeededUsers: typeof users = [];
  for (const user of users) {
    if (user.smsLockState === SMSLockState.LOCKED) {
      lockedUsers.push(user);
    } else if (user.smsLockState === SMSLockState.REVIEW_NEEDED) {
      reviewNeededUsers.push(user);
    }
  }

  const lockedTeams: typeof teams = [];
  const reviewNeededTeams: typeof teams = [];
  for (const team of teams) {
    if (team.smsLockState === SMSLockState.LOCKED) {
      lockedTeams.push(team);
    } else if (team.smsLockState === SMSLockState.REVIEW_NEEDED) {
      reviewNeededTeams.push(team);
    }
  }

  const resultObj = {
    users: {
      locked: lockedUsers,
      reviewNeeded: reviewNeededUsers,
    },
    teams: {
      locked: lockedTeams,
      reviewNeeded: reviewNeededTeams,
    },
  };

  return resultObj;
};

export default getSMSLockStateTeamsUsers;
