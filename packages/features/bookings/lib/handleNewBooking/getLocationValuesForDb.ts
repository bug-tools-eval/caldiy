import { getFirstDelegationConferencingCredentialAppLocation } from "@calcom/app-store/delegationCredential";
import { withReporting } from "@calcom/lib/sentryWrapper";
import type { Prisma } from "@calcom/prisma/client";
import { userMetadata as userMetadataSchema } from "@calcom/prisma/zod-utils";
import type { CredentialForCalendarService } from "@calcom/types/Credential";

const sortUsersByDynamicList = <TUser extends { username: string | null }>(
  users: TUser[],
  dynamicUserList: string[]
) => {
  const indexByUsername = new Map<string, number>(dynamicUserList.map((name, idx) => [name, idx]));
  // Preserves the original `indexOf` semantics: returns -1 when the username is
  // missing from the list (kept by `|| 0` because -1 is truthy), and 0 for both
  // a missing-username record and a record whose username sits at index 0.
  const indexOf = (name: string) => indexByUsername.get(name) ?? -1;
  return users.sort((a, b) => {
    const aIndex = (a.username && indexOf(a.username)) || 0;
    const bIndex = (b.username && indexOf(b.username)) || 0;
    return aIndex - bIndex;
  });
};

export const _getLocationValuesForDb = <
  TUser extends {
    username: string | null;
    metadata: Prisma.JsonValue;
    credentials: CredentialForCalendarService[];
  },
>({
  dynamicUserList,
  users,
  location: locationBodyString,
}: {
  dynamicUserList: string[];
  users: TUser[];
  location: string;
}) => {
  const isDynamicGroupBookingCase = dynamicUserList.length > 1;
  let firstDynamicGroupMemberDefaultLocationUrl;
  // TODO: It's definition should be moved to getLocationValueForDb
  if (isDynamicGroupBookingCase) {
    users = sortUsersByDynamicList(users, dynamicUserList);
    const firstDynamicGroupMember = users[0];
    const firstDynamicGroupMemberMetadata = userMetadataSchema.parse(firstDynamicGroupMember.metadata);
    const firstDynamicGroupMemberDelegationCredentialConferencingAppLocation =
      getFirstDelegationConferencingCredentialAppLocation({
        credentials: firstDynamicGroupMember.credentials,
      });

    const defaultConferencingApp = firstDynamicGroupMemberMetadata?.defaultConferencingApp;

    const hasMemberSetConferencingPreference =
      !!defaultConferencingApp?.appSlug || !!defaultConferencingApp?.appLink;

    firstDynamicGroupMemberDefaultLocationUrl =
      (hasMemberSetConferencingPreference
        ? defaultConferencingApp?.appLink
        : firstDynamicGroupMemberDelegationCredentialConferencingAppLocation) ?? null;

    locationBodyString = firstDynamicGroupMemberDefaultLocationUrl || locationBodyString;
  }

  return {
    locationBodyString,
    organizerOrFirstDynamicGroupMemberDefaultLocationUrl: firstDynamicGroupMemberDefaultLocationUrl,
  };
};

export const getLocationValuesForDb = withReporting(_getLocationValuesForDb, "getLocationValuesForDb");
