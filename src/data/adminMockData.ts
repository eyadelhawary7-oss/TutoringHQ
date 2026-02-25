export type Plan = 'starter' | 'pro' | 'business' | 'enterprise' | 'top_centers';

export interface AdminCenter {
  id: string;
  name: string;
  plan: Plan;
  subscription_status: 'active' | 'suspended' | 'pending';
}

export const adminCenters: AdminCenter[] = [
  { id: '1', name: 'سنتر الأوائل', plan: 'top_centers', subscription_status: 'active' },
  { id: '2', name: 'سنتر الريادة', plan: 'enterprise', subscription_status: 'active' },
  { id: '3', name: 'سنتر التفوق', plan: 'enterprise', subscription_status: 'active' },
  { id: '4', name: 'سنتر المستقبل', plan: 'business', subscription_status: 'active' },
  { id: '5', name: 'سنتر النور', plan: 'pro', subscription_status: 'active' },
  { id: '6', name: 'سنتر الإبداع', plan: 'pro', subscription_status: 'active' },
  { id: '7', name: 'سنتر الأمل', plan: 'starter', subscription_status: 'active' },
  { id: '8', name: 'سنتر النجاح', plan: 'pro', subscription_status: 'active' },
  { id: '9', name: 'سنتر التميز', plan: 'starter', subscription_status: 'active' },
  { id: '10', name: 'سنتر العلم', plan: 'starter', subscription_status: 'suspended' },
];
