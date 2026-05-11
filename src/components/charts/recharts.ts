// Centralized re-export of recharts primitives. Direct imports from
// 'recharts' elsewhere in src/ are forbidden (audit Part 1 Phase 11).
export {
  BarChart, Bar,
  PieChart, Pie, Cell,
  AreaChart, Area,
  ComposedChart, Line,
  XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
