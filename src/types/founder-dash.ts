export interface ActionQueueItem {
  id: string;
  type: string;
  priority: 'red' | 'amber' | 'green';
  title: string;
  subtitle: string | null;
  action_label: string | null;
  action_url: string | null;
  revenue_at_risk: number;
  center_id: string | null;
  lead_id: string | null;
}

export interface PendingCenter {
  id: string;
  name: string;
  phone: string | null;
  owner_name: string | null;
  city: string | null;
  district: string | null;
  plan: string;
  created_at: string;
  signup_notes: string | null;
}

export interface CommandStripResponse {
  stats: {
    pendingApprovals: number;
    leadsNeedingReply: number;
    overduePayments: number;
    atRiskCenters: number;
  };
  actionQueue: ActionQueueItem[];
  pendingCenters: PendingCenter[];
  breakeven: {
    target: number;
    activePayingCenters: number;
  };
}

export interface PipelineStage {
  stage: string;
  count: number;
}

export interface DistrictRow {
  district: string | null;
  centerCount: number;
  leadCount: number;
}

export interface GrowthPanelResponse {
  pipeline: {
    stages: PipelineStage[];
    totalActive: number;
  };
  geography: DistrictRow[];
  referral: {
    totalReferrers: number;
    totalReferrals: number;
    converted: number;
    conversionRate: number;
    commissionsOwed: number;
    commissionsPaid: number;
  };
}

export interface CenterHealthRow {
  id: string;
  name: string;
  district: string | null;
  plan: string;
  status: string;
  subscription_status: string;
  health_score: number | null;
  health_score_band: string | null;
  last_scan_at: string | null;
}

export interface HealthSummary {
  healthy: number;
  engaged: number;
  atRisk: number;
  critical: number;
  noScore: number;
}

export interface HealthPanelResponse {
  centers: CenterHealthRow[];
  summary: HealthSummary;
}
