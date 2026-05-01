import { getCalendar } from "@calcom/app-store/_utils/getCalendar";
import {
  getAllDelegationCredentialsForUserIncludeServiceAccountKey,
  getDelegationCredentialOrFindRegularCredential,
} from "@calcom/app-store/delegationCredential";
import { deleteMeeting } from "@calcom/features/conferencing/lib/videoClient";
import prisma from "@calcom/prisma";
import type { Attendee } from "@calcom/prisma/client";
import { BookingStatus } from "@calcom/prisma/enums";
import type { CalendarEvent } from "@calcom/types/Calendar";
import type { OriginalRescheduledBooking } from "../../handleNewBooking/originalRescheduledBookingUtils";

/* Check if the original booking has no more attendees, if so delete the booking
  and any calendar or video integrations */
const lastAttendeeDeleteBooking = async (
  originalRescheduledBooking: OriginalRescheduledBooking,
  filteredAttendees: Partial<Attendee>[] | undefined,
  originalBookingEvt?: CalendarEvent
) => {
  let deletedReferences = false;
  const bookingUser = originalRescheduledBooking?.user;
  const delegationCredentials = bookingUser
    ? // We fetch delegation credentials with ServiceAccount key as CalendarService instance created later in the flow needs it
      await getAllDelegationCredentialsForUserIncludeServiceAccountKey({
        user: { email: bookingUser.email, id: bookingUser.id },
      })
    : [];
  if ((!filteredAttendees || filteredAttendees.length === 0) && originalRescheduledBooking) {
    // Parallelize per-reference credential + calendar resolution; integration
    // calls were already collected for Promise.all but the lookups themselves
    // were serialized in the for-of loop.
    const referenceIntegrationPromises = originalRescheduledBooking.references.map(async (reference) => {
      if (!reference.credentialId && !reference.delegationCredentialId) return [] as Promise<unknown>[];
      const credential = await getDelegationCredentialOrFindRegularCredential({
        id: {
          credentialId: reference.credentialId,
          delegationCredentialId: reference.delegationCredentialId,
        },
        delegationCredentials,
      });
      if (!credential) return [] as Promise<unknown>[];

      const calls: Promise<unknown>[] = [];
      if (reference.type.includes("_video")) {
        calls.push(deleteMeeting(credential, reference.uid));
      }
      if (reference.type.includes("_calendar") && originalBookingEvt) {
        const calendar = await getCalendar(credential, "booking");
        if (calendar) {
          calls.push(calendar.deleteEvent(reference.uid, originalBookingEvt, reference.externalCalendarId));
        }
      }
      return calls;
    });

    const integrationsToDelete = (await Promise.all(referenceIntegrationPromises)).flat();

    await Promise.all(integrationsToDelete).then(async () => {
      await prisma.booking.update({
        where: {
          id: originalRescheduledBooking.id,
        },
        data: {
          status: BookingStatus.CANCELLED,
        },
      });
    });
    deletedReferences = true;
  }
  return deletedReferences;
};

export default lastAttendeeDeleteBooking;
