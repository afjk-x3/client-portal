const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const ordinal = (n: number) => {
  const suffixes = ["th", "st", "nd", "rd"];
  const remainder = n % 100;
  return suffixes[(remainder - 20) % 10] || suffixes[remainder] || suffixes[0];
};

/** How the Schedules page describes a repeat: "Monthly on the 1st". */
export function describeRepeat(everyMonths: 1 | 3 | 12, dayOfMonth: number, nextSendOn: string): string {
  if (everyMonths === 12) {
    // The month comes from the date (it never changes), the day from the rule,
    // so a date clamped to Feb 28 still reads "Feb 29".
    const [, month] = nextSendOn.split("-");
    return `Yearly on ${MONTHS[Number(month) - 1]} ${dayOfMonth}`;
  }
  return `${everyMonths === 1 ? "Monthly" : "Quarterly"} on the ${dayOfMonth}${ordinal(dayOfMonth)}`;
}
