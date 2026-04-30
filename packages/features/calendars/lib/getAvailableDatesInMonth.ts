import { daysInMonth, yyyymmdd } from "@calcom/lib/dayjs";

// calculate the available dates in the month:
// *) Intersect with included dates.
// *) Dates in the past are not available.
// *) Use right amount of days in given month. (28, 30, 31)
export function getAvailableDatesInMonth({
  browsingDate,
  minDate = new Date(),
  includedDates,
}: {
  browsingDate: Date;
  minDate?: Date;
  includedDates?: string[];
}) {
  const dates = [];
  const lastDateOfMonth = new Date(
    browsingDate.getFullYear(),
    browsingDate.getMonth(),
    daysInMonth(browsingDate)
  );
  // `lastDateOfMonth` is constructed at midnight (no time component) and the
  // loop step constructs `date` at midnight too, so a same-day check reduces
  // to a Y/M/D equality on the same Date primitive — no need to construct a
  // dayjs instance per iteration.
  const lastY = lastDateOfMonth.getFullYear();
  const lastM = lastDateOfMonth.getMonth();
  const lastD = lastDateOfMonth.getDate();
  const isSameDayAsLast = (d: Date) =>
    d.getFullYear() === lastY && d.getMonth() === lastM && d.getDate() === lastD;
  // Includes lookup: convert to Set once if provided.
  const includedDateSet = includedDates ? new Set(includedDates) : null;
  for (
    let date = browsingDate > minDate ? browsingDate : minDate;
    date < lastDateOfMonth || isSameDayAsLast(date);
    date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  ) {
    const formatted = yyyymmdd(date);
    if (includedDateSet && !includedDateSet.has(formatted)) {
      continue;
    }
    dates.push(formatted);
  }
  return dates;
}
