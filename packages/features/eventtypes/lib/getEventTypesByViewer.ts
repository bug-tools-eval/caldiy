import process from "node:process";
import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import { hasFilter } from "@calcom/features/filters/lib/hasFilter";
import { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { ProfileRepository } from "@calcom/features/profile/repositories/ProfileRepository";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { getPlaceholderAvatar } from "@calcom/lib/defaultAvatarImage";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { getUserAvatarUrl } from "@calcom/lib/getAvatarUrl";
import logger from "@calcom/lib/logger";
import { markdownToSafeHTML } from "@calcom/lib/markdownToSafeHTML";
import { safeStringify } from "@calcom/lib/safeStringify";
import prisma from "@calcom/prisma";
import { MembershipRole, SchedulingType } from "@calcom/prisma/enums";
import { eventTypeMetaDataSchemaWithUntypedApps, teamMetadataSchema } from "@calcom/prisma/zod-utils";
import { orderBy } from "lodash";

class PermissionCheckService {
  constructor(_prisma?: unknown) {}
  async checkPermission(..._args: unknown[]) {
    return true;
  }
  async hasPermission(..._args: unknown[]) {
    return true;
  }
  async getTeamIdsWithPermission(..._args: unknown[]): Promise<number[]> {
    return [];
  }
}
const getBookerBaseUrl = async (_orgSlug?: string | number | null): Promise<string> =>
  process.env.NEXT_PUBLIC_WEBAPP_URL || "https://app.cal.com";
const getBookerBaseUrlSync = (_orgSlug?: string | number | null): string =>
  process.env.NEXT_PUBLIC_WEBAPP_URL || "https://app.cal.com";

const log = logger.getSubLogger({ prefix: ["viewer.eventTypes.getByViewer"] });

type User = {
  id: number;
  profile: {
    upId: string;
  };
};

type Filters = {
  teamIds?: number[];
  upIds?: string[];
  schedulingTypes?: SchedulingType[];
};

export type EventTypesByViewer = Awaited<ReturnType<typeof getEventTypesByViewer>>;

export const getEventTypesByViewer = async (user: User, filters?: Filters) => {
  const userProfile = user.profile;
  const profile = await ProfileRepository.findByUpIdWithAuth(userProfile.upId, user.id);
  const parentOrgHasLockedEventTypes =
    profile?.organization?.organizationSettings?.lockEventTypeCreationForUsers;
  const isFilterSet = filters && hasFilter(filters);
  const isUpIdInFilter = filters?.upIds?.includes(userProfile.upId);

  let shouldListUserEvents = !isFilterSet || isUpIdInFilter;
  // FIX: Handles the case when an upId != lightProfile - pretend like there is no filter.
  // Results in {"eventTypeGroups":[],"profiles":[]} - this crashes all dependencies.
  if (isFilterSet && filters?.upIds && !isUpIdInFilter) {
    shouldListUserEvents = true;
  }

  const permissionCheckService = new PermissionCheckService();
  const [teamsWithEventTypeReadPermission, teamsWithEventTypeUpdatePermission] = await Promise.all([
    permissionCheckService.getTeamIdsWithPermission({
      userId: user.id,
      permission: "eventType.read",
      fallbackRoles: [MembershipRole.MEMBER, MembershipRole.ADMIN, MembershipRole.OWNER],
    }),
    permissionCheckService.getTeamIdsWithPermission({
      userId: user.id,
      permission: "eventType.update",
      fallbackRoles: [MembershipRole.ADMIN, MembershipRole.OWNER],
    }),
  ]);

  const eventTypeRepo = new EventTypeRepository(prisma);
  const [profileMemberships, profileEventTypes] = await Promise.all([
    MembershipRepository.findAllByUpIdIncludeTeamWithMembersAndEventTypes(
      {
        upId: userProfile.upId,
      },
      {
        where: {
          accepted: true,
        },
      }
    ),
    shouldListUserEvents
      ? eventTypeRepo.findAllByUpId(
          {
            upId: userProfile.upId,
            userId: user.id,
          },
          {
            where: {
              teamId: null,
            },
            orderBy: [
              {
                position: "desc",
              },
              {
                id: "asc",
              },
            ],
          }
        )
      : [],
  ]);

  if (!profile) {
    throw new ErrorWithCode(ErrorCode.InternalServerError, "Profile not found");
  }

  const memberships = profileMemberships.map((membership) => ({
    ...membership,
    team: {
      ...membership.team,
      metadata: teamMetadataSchema.parse(membership.team.metadata),
    },
  }));

  log.debug(
    safeStringify({
      profileMemberships,
      profileEventTypes,
    })
  );

  type UserEventTypes = (typeof profileEventTypes)[number];
  type EventTypeUser = UserEventTypes["users"][number];

  const isDefined = <T>(value: T | null | undefined): value is T => value !== null && value !== undefined;

  const getEventTypeUsers = (eventType: UserEventTypes): EventTypeUser[] => {
    const eventTypeUsers = eventType?.hosts?.length
      ? eventType.hosts.map((host) => host.user)
      : eventType.users;

    return eventTypeUsers.filter(isDefined);
  };

  const mapEventTypes = async (eventTypes: UserEventTypes[]) => {
    const userRepo = new UserRepository(prisma);
    const usersById = new Map<number, EventTypeUser>();

    eventTypes.forEach((eventType) => {
      getEventTypeUsers(eventType).forEach((user) => {
        usersById.set(user.id, user);
      });

      (eventType.children || []).forEach((child) => {
        child.users.forEach((user) => {
          usersById.set(user.id, user);
        });
      });
    });

    const enrichedUsers = await userRepo.enrichUsersWithTheirProfiles(Array.from(usersById.values()));
    const enrichedUsersById = new Map(enrichedUsers.map((user) => [user.id, user]));

    return eventTypes.map((eventType) => ({
      ...eventType,
      safeDescription: eventType?.description ? markdownToSafeHTML(eventType.description) : undefined,
      users: getEventTypeUsers(eventType)
        .map((user) => enrichedUsersById.get(user.id))
        .filter(isDefined),
      metadata: eventType.metadata ? eventTypeMetaDataSchemaWithUntypedApps.parse(eventType.metadata) : null,
      children: (eventType.children || []).map((child) => ({
        ...child,
        users: child.users.map((user) => enrichedUsersById.get(user.id)).filter(isDefined),
      })),
    }));
  };

  type MappedEventType = Awaited<ReturnType<typeof mapEventTypes>>[number];

  const teamMembershipsForGroups = memberships.filter((mmship) => {
    if (mmship.team.isOrganization) {
      return false;
    }
    if (!filters || !hasFilter(filters)) {
      return true;
    }
    return filters?.teamIds?.includes(mmship?.team?.id || 0) ?? false;
  });

  const mappedEventTypes = await mapEventTypes([
    ...profileEventTypes,
    ...teamMembershipsForGroups.flatMap((membership) => membership.team.eventTypes),
  ]);
  const mappedEventTypesById = new Map(mappedEventTypes.map((eventType) => [eventType.id, eventType]));

  const userEventTypes = profileEventTypes
    .map((eventType) => mappedEventTypesById.get(eventType.id))
    .filter(isDefined)
    .filter((eventType) => {
      const isAChildEvent = eventType.parentId;
      if (!isAChildEvent) {
        return true;
      }
      // A child event only has one user
      const childEventAssignee = eventType.users[0];
      if (!childEventAssignee || childEventAssignee.id !== user.id) {
        return false;
      }
      return true;
    });

  type EventTypeGroup = {
    teamId?: number | null;
    parentId?: number | null;
    bookerUrl: string;
    membershipRole?: MembershipRole | null;
    profile: {
      slug: (typeof profile)["username"] | null;
      name: (typeof profile)["name"];
      image: string;
      eventTypesLockedByOrg?: boolean;
    };
    metadata: {
      membershipCount: number;
      readOnly: boolean;
    };
    eventTypes: typeof userEventTypes;
  };

  let eventTypeGroups: EventTypeGroup[] = [];

  const unmanagedEventTypes = userEventTypes.filter(
    (evType) => evType.schedulingType !== SchedulingType.MANAGED
  );

  log.debug(safeStringify({ profileMemberships, profileEventTypes, profile }));

  log.debug(
    "Filter Settings",
    safeStringify({
      isFilterSet,
      isProfileIdInFilter: isUpIdInFilter,
    })
  );

  if (shouldListUserEvents) {
    const bookerUrl = await getBookerBaseUrl(profile.organizationId ?? null);
    eventTypeGroups.push({
      teamId: null,
      bookerUrl,
      membershipRole: null,
      profile: {
        slug: profile.username,
        name: profile.name,
        image: getUserAvatarUrl({
          avatarUrl: profile.avatarUrl,
        }),
        eventTypesLockedByOrg: parentOrgHasLockedEventTypes,
      },
      eventTypes: orderBy(unmanagedEventTypes, ["position", "id"], ["desc", "asc"]),
      metadata: {
        membershipCount: 1,
        readOnly: false,
      },
    });
  }

  const teamMemberships = profileMemberships.map((membership) => ({
    teamId: membership.team.id,
    membershipRole: membership.role,
  }));

  const filterByTeamIds = (eventType: MappedEventType) => {
    if (!filters || !hasFilter(filters)) {
      return true;
    }
    return filters?.teamIds?.includes(eventType?.teamId || 0) ?? false;
  };
  const filterBySchedulingTypes = (evType: MappedEventType) => {
    if (!filters || !hasFilter(filters) || !filters.schedulingTypes) {
      return true;
    }

    if (!evType.schedulingType) return false;

    return filters.schedulingTypes.includes(evType.schedulingType);
  };

  eventTypeGroups = ([] as EventTypeGroup[]).concat(
    eventTypeGroups,
    teamMembershipsForGroups.map((membership) => {
      const orgMembership = teamMemberships.find(
        (teamM) => teamM.teamId === membership.team.parentId
      )?.membershipRole;

      const team = {
        ...membership.team,
        metadata: teamMetadataSchema.parse(membership.team.metadata),
      };

      let slug: string | null = null;
      if (team.slug) {
        // In an Org, a team can be accessed without /team prefix as well as with /team prefix
        slug = team.parentId ? team.slug : `team/${team.slug}`;
      }

      const eventTypes = team.eventTypes
        .map((eventType) => mappedEventTypesById.get(eventType.id))
        .filter(isDefined);
      const teamParentMetadata = team.parent ? teamMetadataSchema.parse(team.parent.metadata) : null;
      return {
        teamId: team.id,
        parentId: team.parentId,
        bookerUrl: getBookerBaseUrlSync(team.parent?.slug ?? teamParentMetadata?.requestedSlug ?? null),
        membershipRole:
          orgMembership && compareMembership(orgMembership, membership.role)
            ? orgMembership
            : membership.role,
        profile: {
          image: team.parent
            ? getPlaceholderAvatar(team.parent.logoUrl, team.parent.name)
            : getPlaceholderAvatar(team.logoUrl, team.name),
          name: team.name,
          slug,
        },
        metadata: {
          membershipCount: team.members.length,
          readOnly: !teamsWithEventTypeReadPermission.includes(team.id),
        },
        eventTypes: eventTypes
          .filter(filterByTeamIds)
          .filter((evType) => {
            const res = evType.userId === null || evType.userId === user.id;
            return res;
          })
          .filter((evType) =>
            !teamsWithEventTypeUpdatePermission.includes(team.id)
              ? evType.schedulingType !== SchedulingType.MANAGED
              : true
          )
          .filter(filterBySchedulingTypes),
      };
    })
  );

  const denormalizedPayload = {
    eventTypeGroups,
    // so we can show a dropdown when the user has teams
    profiles: eventTypeGroups.map((group) => ({
      ...group.profile,
      ...group.metadata,
      teamId: group.teamId,
      membershipRole: group.membershipRole,
    })),
  };

  return normalizePayload(denormalizedPayload);

  /**
   * Reduces the size of payload
   */
  function normalizePayload(payload: typeof denormalizedPayload) {
    const allUsersAcrossAllEventTypes = new Map<
      number,
      EventTypeGroup["eventTypes"][number]["users"][number]
    >();
    const eventTypeGroups = payload.eventTypeGroups.map((group) => {
      return {
        ...group,
        eventTypes: group.eventTypes.map((eventType) => {
          const { users, ...rest } = eventType;
          return {
            ...rest,
            // Send userIds per event and keep the actual users object outside
            userIds: users.map((user) => {
              allUsersAcrossAllEventTypes.set(user.id, user);
              return user.id;
            }),
          };
        }),
      };
    });

    return {
      ...payload,
      allUsersAcrossAllEventTypes,
      eventTypeGroups,
    };
  }
};

export function compareMembership(mship1: MembershipRole, mship2: MembershipRole) {
  const mshipToNumber = (mship: MembershipRole) => Object.keys(MembershipRole).indexOf(mship);
  return mshipToNumber(mship1) > mshipToNumber(mship2);
}
