import { Card, CountTile, Empty, MoneyTile, Row } from '@/components/ui';
import { formatCount, formatQty, NOT_AVAILABLE } from '@/lib/money';
import { riyadhTime } from '@/lib/freshness';
import { loadPosition, loadStock } from '@/server/data';
import { requireUser } from '@/server/session';

const REASONS: Record<string, string> = { sale: 'Sold', grn: 'Received from suppliers', refund: 'Returned by customers', purchase_return: 'Returned to suppliers', waste: 'Wastage', count_adj: 'Stock count changes' };

export default async function StockPage() {
  const user = await requireUser();
  const [stock, position] = await Promise.all([loadStock(user), loadPosition(user)]);
  return (
    <main className="page">
      <h2 className="title">Stock</h2>
      <p className="sub">Right now, as of {stock ? riyadhTime(stock.asOf) : NOT_AVAILABLE}. Saudi time.</p>
      <div className="grid">
        <CountTile label="Products" value={stock?.products} />
        <CountTile label="In stock" value={stock?.inStock} />
        <CountTile label="Low stock" value={stock?.lowStockCount} />
        <CountTile label="Out of stock" value={stock?.outOfStockCount} />
        <MoneyTile label="Stock value" value={position?.inventoryValue} note="At average cost" />
      </div>
      <Card title="Low stock">
        {!stock ? <Empty>{NOT_AVAILABLE}</Empty> : stock.lowStock.length === 0 ? <Empty>Nothing is low.</Empty> : <div className="rows">{stock.lowStock.map((r) => <Row key={r.sku} label={r.name} sub={`Reorder at ${formatQty(r.reorderLevel)}`} value={formatQty(r.qty)} />)}</div>}
      </Card>
      <Card title="Out of stock">
        {!stock ? <Empty>{NOT_AVAILABLE}</Empty> : stock.outOfStock.length === 0 ? <Empty>Nothing is out of stock.</Empty> : <div className="rows">{stock.outOfStock.map((r) => <Row key={r.sku} label={r.name} value={formatQty(r.qty)} />)}</div>}
      </Card>
      <Card title="Stock movement" note={stock ? `last ${stock.movementDays} days` : undefined}>
        {!stock ? <Empty>{NOT_AVAILABLE}</Empty> : stock.movements.length === 0 ? <Empty>No stock moved in this time.</Empty> : <div className="rows">{stock.movements.map((m) => <Row key={m.reason} label={REASONS[m.reason] ?? m.reason} sub={`${formatCount(m.lines)} records`} value={formatQty(m.qty)} />)}</div>}
      </Card>
    </main>
  );
}
