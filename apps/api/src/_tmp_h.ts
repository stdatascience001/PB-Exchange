import { db, shifts } from '@pb/database';
import { eq } from 'drizzle-orm';
import { TransactionService } from './modules/transactions/transaction.service.js';
const live = [111,70,99,50,61,263,69,50,53,590, 70,23,26,9,169,30,12,27,5,41, 42,3,30,3,475,3,1,11,1,150, 73,32,31,3,66,26,51,24,3,18, 31,11,18,1,46,9,1,9,5,181, 128,41,72,36,42,46,89,34,43,12, 205,8,9,3,31,27,8,9,9,4, 84,24,35,1,66,26,5,28,3,9, 38,8,41,3,46,0,8,5,1,1, 58,8,24,5,39,12,31,3,5,124];
(async () => {
  const [s] = await db.select().from(shifts).where(eq(shifts.name, 'HYDRABAD NIGHT'));
  const r: any = await TransactionService.getCollectionView({ shiftId: s.id, date: '2026-11-18', hpl: true } as any);
  const g = new Map(r.grid.map((c: any) => [c.number, c.totalAmount]));
  let sum = 0;
  for (let n = 1; n <= 100; n++) { const k = n === 100 ? '00' : String(n).padStart(2, '0'); const v = g.get(k) as number; sum += v; if (v !== live[n-1]) console.log(n, 'ours', v, 'live', live[n-1]); }
  console.log('sum', sum, 'liveSum', live.reduce((a,b)=>a+b,0));
  process.exit(0);
})();
