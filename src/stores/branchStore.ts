import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Branch {
  id: string;
  name: string;
  logo_url?: string | null;
}

interface BranchState {
  activeCenterId: string | null;
  branches: Branch[];
  setActiveCenterId: (id: string | null) => void;
  setBranches: (branches: Branch[]) => void;
}

export const useBranchStore = create<BranchState>()(
  persist(
    (set) => ({
      activeCenterId: null,
      branches: [],
      setActiveCenterId: (id) => set({ activeCenterId: id }),
      setBranches: (branches) => set({ branches }),
    }),
    { name: 'centerhq-active-branch', partialize: (s) => ({ activeCenterId: s.activeCenterId }) }
  )
);
