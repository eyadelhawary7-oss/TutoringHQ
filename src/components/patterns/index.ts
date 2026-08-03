/**
 * The shared pattern primitives — `Merged-Design-Patterns` §02–§06.
 *
 * MANDATORY, not optional. A screen needing a row action, a quick menu, a group
 * action bar or an expand sheet uses these. Rolling a local one is not allowed,
 * even if it is smaller. If a primitive cannot do what a screen needs, that is a
 * signal the primitive is wrong — stop and say so rather than forking it.
 *
 * See `design/PER-FILE-PROMPT.md` § "The shared-primitive rule", which also
 * lists the three screens still running their own three-dot menu and names the
 * merged file each one converts under.
 *
 * §01 Empty States lives in `@/components/shared/EmptyState` rather than here,
 * because it already had 11 adopters under that path and moving it would have
 * been an unrelated rename in a pattern PR.
 */
export { default as ActionSheet, type SheetAction } from './ActionSheet';
export { default as ListRow } from './ListRow';
export { default as RecordActionBar } from './RecordActionBar';
export { default as ExpandableRow, type InlineAction } from './ExpandableRow';
export { ListSkeleton, RecordSkeleton, StillWorking, ActionSpinner } from './LoadingStates';
export { default as SegmentedControl, type Segment } from './SegmentedControl';
export { default as CapacityBar } from './CapacityBar';
export { default as GroupCard } from './GroupCard';
