export type FinanceNorthStar = {
  totalMRR: number;
  activeCenters: number;
  thisMonthRevenue: number;
  outstandingTotal: number;
  outstandingCount: number;
  mrrChangePct: number;
  newCentersThisMonth: number;
};

export type FinanceUnitEconomics = {
  monthlyChurnRate: number;
  ltv: number;
  ttfpDays: number | null;
};

export type FinanceMrrPoint = { month: string; amount: number };

export type FinanceRevenueSlice = { type: string; label: string; amount: number; pct: number };

export type FinancePlanCount = { plan: string; count: number };

export type FinanceCohort = {
  cohortMonth: string;
  size: number;
  retention: (number | null)[];
};

export type FinanceOutstandingInvoice = {
  invoiceId: string;
  centerId: string;
  centerName: string;
  amount: number;
  daysOverdue: number;
};

export type FinanceAtRiskCenter = {
  centerId: string;
  centerName: string;
  healthScore: number;
  reason: string;
};

export type FinanceCardPipeline = {
  pendingVendor: number;
  inTransit: number;
  delivered: number;
  failed: number;
};

export type FinanceData = {
  northStar: FinanceNorthStar;
  unitEconomics: FinanceUnitEconomics;
  mrrTrend: FinanceMrrPoint[];
  revenueByType: FinanceRevenueSlice[];
  planDistribution: FinancePlanCount[];
  cohorts: FinanceCohort[];
  outstandingInvoices: FinanceOutstandingInvoice[];
  atRiskCenters: FinanceAtRiskCenter[];
  cardPipeline: FinanceCardPipeline;
  generatedAt: string;
};
