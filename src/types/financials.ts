export interface MonthlyRevenue {
  month: string;
  subscriptionRevenue: number;
  cardOrderRevenue: number;
  whatsappPackRevenue: number;
  totalRevenue: number;
}

export interface CardOrderStats {
  totalCardsSold: number;
  revenueAllTime: number;
  revenueThisMonth: number;
  averageOrderValue: number;
  pendingOrders: number;
  paidOrders: number;
}

export interface WhatsAppPackStats {
  activeParents: number;
  packMRR: number;
  growthVsLastMonth: number;
}

export interface AnnualView {
  currentYearRevenue: number;
  bestMonth: string | null;
  worstMonth: string | null;
}

export interface CurrentMonthFinancials {
  subscriptionRevenue: number;
  cardOrderRevenue: number;
  whatsappPackRevenue: number;
  totalRevenue: number;
  fixedCosts: number;
  variableCosts: number;
}

export interface FinancialsResponse {
  currentMonth: CurrentMonthFinancials;
  monthly: MonthlyRevenue[];
  cardOrders: CardOrderStats;
  whatsappPack: WhatsAppPackStats;
  annualView: AnnualView;
}
