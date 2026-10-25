import "server-only";

export type RebateTransaction = {
  id: string;
  kind: "CREDIT" | "REVERSAL";
  delta_paise: string;
  created_at: string;
  meal_date: string;
  meal_type: string;
  menu: string;
};

export type MonthlyRebates = {
  month: string;
  total_credit_paise: string;
  total_reversal_paise: string;
  net_rebate_paise: string;
  transaction_count: number;
  transactions: RebateTransaction[];
};

export function isBillingMonth(value: string): boolean {
  return /^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(value);
}

export function getCurrentBillingMonth(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")!.value;
  const month = parts.find((part) => part.type === "month")!.value;

  return `${year}-${month}`;
}

export function formatPaise(value: string): string {
  const amount = BigInt(value);
  const zero = BigInt(0);
  const hundred = BigInt(100);

  const negative = amount < zero;
  const absolute = negative ? -amount : amount;

  const rupees = (absolute / hundred).toLocaleString("en-IN");
  const paise = (absolute % hundred).toString().padStart(2, "0");

  return `${negative ? "-" : ""}₹${rupees}.${paise}`;
}