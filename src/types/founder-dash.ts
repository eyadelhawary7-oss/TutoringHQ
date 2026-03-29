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
