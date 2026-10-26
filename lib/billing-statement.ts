import "server-only";

export type BillItem = {
  charge_id: string;
  meal_slot_id: string;
  meal_date: string;
  meal_type: string;
  menu: string;
  origin: "FIRST_OPT_IN" | "OPENING_SNAPSHOT";
  base_charge_paise: string;
  net_rebate_paise: string;
  amount_due_paise: string;
};

export type MonthlyBill = {
  month: string;
  status: "LIVE_SUMMARY";
  policy: string;
  base_charges_paise: string;
  net_rebate_paise: string;
  amount_due_paise: string;
  charged_meal_count: number;
  opening_snapshot_count: number;
  uncharged_opted_out_count: number;
  items: BillItem[];
};