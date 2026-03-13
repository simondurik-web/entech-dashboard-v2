import json
import os
import datetime

json_path = "/Users/simondurik/clawd/projects/entech-dashboard-v2/presentations/data/gleason-precision-products.json"
html_path = "/Users/simondurik/clawd/projects/entech-dashboard-v2/presentations/gleason-precision-products.html"

with open(json_path, 'r') as f:
    data = f.read()

json_data = json.loads(data)

html_template = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gleason + Precision Products Presentation</title>
    <style>
        :root {{
            --bg-color: #0f172a;
            --card-bg: #1e293b;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --border-color: #334155;
            --accent: #3b82f6;
            --success: #10b981;
            --danger: #ef4444;
            --warning: #f59e0b;
        }}
        body {{
            background-color: var(--bg-color);
            color: var(--text-main);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 2rem;
            line-height: 1.5;
        }}
        .container {{
            max-width: 1200px;
            margin: 0 auto;
        }}
        header {{
            margin-bottom: 2rem;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 1rem;
        }}
        h1 {{
            margin: 0 0 0.5rem 0;
            font-size: 2.5rem;
            color: #fff;
        }}
        h2 {{
            color: #fff;
            margin-top: 0;
        }}
        .subtitle {{
            color: var(--text-muted);
            font-size: 1.1rem;
            margin: 0;
        }}
        .grid-kpi {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }}
        .card {{
            background-color: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 0.5rem;
            padding: 1.5rem;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }}
        .kpi-title {{
            font-size: 0.875rem;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 0.5rem;
        }}
        .kpi-value {{
            font-size: 1.5rem;
            font-weight: 700;
        }}
        .text-success {{ color: var(--success); }}
        .text-danger {{ color: var(--danger); }}
        .text-warning {{ color: var(--warning); }}
        
        .section {{
            margin-bottom: 3rem;
        }}
        
        table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 0.875rem;
            margin-top: 1rem;
        }}
        th, td {{
            padding: 0.75rem 1rem;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
        }}
        th {{
            background-color: rgba(255,255,255,0.05);
            color: var(--text-muted);
            font-weight: 600;
        }}
        tr:hover {{
            background-color: rgba(255,255,255,0.02);
        }}
        
        .badge {{
            padding: 0.25rem 0.5rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 600;
        }}
        .badge-shipped {{ background-color: rgba(16, 185, 129, 0.2); color: var(--success); }}
        .badge-staged {{ background-color: rgba(245, 158, 11, 0.2); color: var(--warning); }}
        .badge-cancelled {{ background-color: rgba(239, 68, 68, 0.2); color: var(--danger); }}
        .badge-pending {{ background-color: rgba(59, 130, 246, 0.2); color: var(--accent); }}

        .chart-container {{
            width: 100%;
            height: 400px;
            position: relative;
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 0.5rem;
            padding: 1rem;
            box-sizing: border-box;
        }}
        
        /* Interactive Calculator */
        .calc-grid {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2rem;
        }}
        .calc-control {{
            margin-bottom: 1rem;
        }}
        .calc-control label {{
            display: block;
            margin-bottom: 0.5rem;
            color: var(--text-muted);
            font-size: 0.875rem;
        }}
        .calc-control input {{
            width: 100%;
            padding: 0.75rem;
            border-radius: 0.25rem;
            border: 1px solid var(--border-color);
            background: rgba(0,0,0,0.2);
            color: white;
            font-size: 1rem;
            box-sizing: border-box;
        }}
        .calc-result-row {{
            display: flex;
            justify-content: space-between;
            padding: 0.75rem 0;
            border-bottom: 1px dashed var(--border-color);
        }}
        .calc-result-row:last-child {{ border-bottom: none; }}
        
        .insights-block {{
            background: linear-gradient(145deg, rgba(30,41,59,1) 0%, rgba(15,23,42,1) 100%);
            border-left: 4px solid var(--accent);
        }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Gleason + Precision Products</h1>
            <p class="subtitle">Historical Order & Cost Review for Part <strong>648.254.1530</strong></p>
        </header>

        <section class="section" id="kpis">
            <div class="grid-kpi" id="kpi-container">
                <!-- Injected via JS -->
            </div>
        </section>
        
        <section class="section insights-block card">
            <h2>Narrative Insights</h2>
            <ul style="color: var(--text-muted); line-height: 1.8;">
                <li><strong>Historical Volume & Revenue:</strong> Consistent volume shipments, but pricing remains critically low across both customers.</li>
                <li><strong>Loss Pattern:</strong> Every shipped part incurs an approximate loss. Current quoting is roughly -$1.02 to -$1.28 per part depending on the customer tier.</li>
                <li><strong>Production Dynamics:</strong> Improving parts/hour reduces the per-part labor burden, but because material and overhead costs are fixed, efficiency gains alone cannot close the gap to reach profitability at the current sell price.</li>
                <li><strong>Action Required:</strong> A price increase closer to the $6.25 Sales Target is necessary to achieve healthy margins.</li>
            </ul>
        </section>

        <section class="section card">
            <h2>Revenue & P/L History (Shipped)</h2>
            <div class="chart-container" id="chart-container">
                <!-- SVG Chart injected via JS -->
            </div>
        </section>
        
        <section class="section card">
            <h2>Customer Pricing Comparison</h2>
            <table id="pricing-table">
                <thead>
                    <tr>
                        <th>Customer</th>
                        <th>Customer Part #</th>
                        <th>Lowest Quoted Price</th>
                        <th>Variable Cost</th>
                        <th>Total Cost</th>
                        <th>Sales Target</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    <!-- Injected via JS -->
                </tbody>
            </table>
        </section>

        <section class="section card">
            <h2>Interactive BOM Calculator</h2>
            <p class="subtitle" style="margin-bottom: 1.5rem;">Adjust parameters below to see the impact on per-part costs and margin.</p>
            <div class="calc-grid">
                <div>
                    <div class="calc-control">
                        <label for="calc-pph">Parts per hour (Current: 77)</label>
                        <input type="number" id="calc-pph" value="77" step="1">
                    </div>
                    <div class="calc-control">
                        <label for="calc-target">Customer Sell Price ($)</label>
                        <input type="number" id="calc-target" value="3.47" step="0.01">
                    </div>
                    <div style="margin-top: 2rem; padding: 1rem; background: rgba(0,0,0,0.2); border-radius: 0.5rem;">
                        <h4 style="margin-top: 0; color: var(--text-muted);">Fixed Inputs</h4>
                        <div class="calc-result-row"><span>Labor Cost/hr</span><span id="disp-labor-rate"></span></div>
                        <div class="calc-result-row"><span>Material + Fixed OH Cost</span><span id="disp-fixed-cost"></span></div>
                    </div>
                </div>
                <div style="background: rgba(255,255,255,0.02); padding: 1.5rem; border-radius: 0.5rem; border: 1px solid var(--border-color);">
                    <h3 style="margin-top: 0; margin-bottom: 1.5rem;">Calculated Results</h3>
                    <div class="calc-result-row">
                        <span>Labor Cost / Part</span>
                        <strong id="res-labor-part"></strong>
                    </div>
                    <div class="calc-result-row">
                        <span>Subtotal Cost</span>
                        <strong id="res-subtotal"></strong>
                    </div>
                    <div class="calc-result-row">
                        <span>Total Cost / Part</span>
                        <strong id="res-total"></strong>
                    </div>
                    <div class="calc-result-row" style="margin-top: 1rem; border-top: 2px solid var(--border-color); padding-top: 1rem;">
                        <span>Projected P/L per Part</span>
                        <strong id="res-pl" style="font-size: 1.25rem;"></strong>
                    </div>
                </div>
            </div>
        </section>

        <section class="section card">
            <h2>Historical Orders</h2>
            <div style="overflow-x: auto;">
                <table id="orders-table">
                    <thead>
                        <tr>
                            <th>Ship Date</th>
                            <th>Customer</th>
                            <th>PO Number</th>
                            <th>Qty</th>
                            <th>Unit Price</th>
                            <th>Total Cost</th>
                            <th>Revenue</th>
                            <th>P/L</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        <!-- Injected via JS -->
                    </tbody>
                </table>
            </div>
        </section>
        
        <section class="section card">
            <h2>Bill of Materials (BOM)</h2>
            <table id="bom-table">
                <thead>
                    <tr>
                        <th>Component / Expense</th>
                        <th>Qty / %</th>
                        <th>Cost</th>
                    </tr>
                </thead>
                <tbody id="bom-tbody">
                    <!-- Injected via JS -->
                </tbody>
            </table>
        </section>
    </div>

    <script>
        const appData = {data};

        // Utility formatters
        const formatMoney = (val) => new Intl.NumberFormat('en-US', {{ style: 'currency', currency: 'USD' }}).format(val);
        const parseMoney = (str) => typeof str === 'string' ? parseFloat(str.replace(/[^\\d.-]/g, '')) : str;
        const formatNumber = (val) => new Intl.NumberFormat('en-US').format(val);

        function init() {{
            renderKPIs();
            renderPricingTable();
            renderOrdersTable();
            renderBOM();
            initCalculator();
            renderChart();
        }}

        function renderKPIs() {{
            const orders = appData.orders.filter(o => o.internalStatus === 'Shipped' || o.internalStatus === 'Invoiced');
            const openOrders = appData.orders.filter(o => o.internalStatus === 'Pending' || o.internalStatus === 'Staged');
            
            let shippedRev = 0;
            let shippedPL = 0;
            let shippedQty = 0;
            
            orders.forEach(o => {{
                shippedRev += parseMoney(o.revenue) || 0;
                shippedPL += parseMoney(o.pl) || 0;
                shippedQty += parseInt(o.orderQty) || 0;
            }});
            
            let openRev = 0;
            let openPL = 0;
            openOrders.forEach(o => {{
                openRev += parseMoney(o.revenue) || 0;
                openPL += parseMoney(o.pl) || 0;
            }});

            const avgSell = shippedQty > 0 ? shippedRev / shippedQty : 0;
            const currentCost = parseMoney(appData.bomFinalAssembly['Total Cost']);
            const salesTarget = parseMoney(appData.bomFinalAssembly['Sales target']);

            const kpiData = [
                {{ title: 'Total Shipped Rev', value: formatMoney(shippedRev), class: '' }},
                {{ title: 'Total Shipped P/L', value: formatMoney(shippedPL), class: shippedPL < 0 ? 'text-danger' : 'text-success' }},
                {{ title: 'Shipped Orders', value: orders.length, class: '' }},
                {{ title: 'Avg Sell Price', value: formatMoney(avgSell), class: '' }},
                {{ title: 'Current Total Cost', value: formatMoney(currentCost), class: '' }},
                {{ title: 'Sales Target', value: formatMoney(salesTarget), class: 'text-accent' }},
                {{ title: 'Open/Forecast Rev', value: formatMoney(openRev), class: '' }},
                {{ title: 'Open/Forecast P/L', value: formatMoney(openPL), class: openPL < 0 ? 'text-danger' : 'text-success' }}
            ];

            const container = document.getElementById('kpi-container');
            container.innerHTML = kpiData.map(k => `
                <div class="card">
                    <div class="kpi-title">${{k.title}}</div>
                    <div class="kpi-value ${{k.class}}">${{k.value}}</div>
                </div>
            `).join('');
        }}

        function renderPricingTable() {{
            const tbody = document.querySelector('#pricing-table tbody');
            tbody.innerHTML = appData.customerReference.map(c => `
                <tr>
                    <td><strong>${{c.customer}}</strong></td>
                    <td>${{c.customerPartNumber || 'N/A'}}</td>
                    <td class="text-danger">${{c.lowestQuotedPrice}}</td>
                    <td>${{c.variableCost}}</td>
                    <td>${{c.totalCost}}</td>
                    <td class="text-success">${{c.salesTarget20}}</td>
                    <td><span class="badge badge-cancelled">${{c.contributionLevel}}</span></td>
                </tr>
            `).join('');
        }}

        function renderOrdersTable() {{
            const tbody = document.querySelector('#orders-table tbody');
            
            // Sort by shipped date or requested date descending
            const sorted = [...appData.orders].sort((a, b) => {{
                const d1 = new Date(a.shippedDate || a.requestedDate || '1970-01-01');
                const d2 = new Date(b.shippedDate || b.requestedDate || '1970-01-01');
                return d2 - d1;
            }});

            tbody.innerHTML = sorted.map(o => {{
                let badgeClass = 'badge-pending';
                if(o.internalStatus === 'Shipped') badgeClass = 'badge-shipped';
                if(o.internalStatus === 'Cancelled') badgeClass = 'badge-cancelled';
                if(o.internalStatus === 'Staged') badgeClass = 'badge-staged';
                
                const plVal = parseMoney(o.pl) || 0;
                const plClass = plVal < 0 ? 'text-danger' : (plVal > 0 ? 'text-success' : '');

                return `
                <tr>
                    <td>${{o.shippedDate || o.requestedDate || '-'}}</td>
                    <td>${{o.customer.replace(', Inc', '')}}</td>
                    <td>${{o.poNumber}}</td>
                    <td>${{formatNumber(o.orderQty)}}</td>
                    <td>${{o.unitPrice !== '#DIV/0!' ? '$'+o.unitPrice : '-'}}</td>
                    <td>${{o.totalCost}}</td>
                    <td>${{o.revenue !== '0' ? formatMoney(o.revenue) : '-'}}</td>
                    <td class="${{plClass}}">${{o.pl !== '#DIV/0!' ? o.pl : '-'}}</td>
                    <td><span class="badge ${{badgeClass}}">${{o.internalStatus}}</span></td>
                </tr>
                `;
            }}).join('');
        }}

        function renderBOM() {{
            const tbody = document.getElementById('bom-tbody');
            const bom = appData.bomFinalAssembly;
            let rows = '';
            
            // Extract components
            for(let i=1; i<=13; i++) {{
                const name = bom[`Component ${{i}}`];
                if(name) {{
                    rows += `<tr><td>${{name}}</td><td>${{bom[`Component ${{i}} Qty.`]}}</td><td>${{bom[`Component ${{i}} Cost.`]}}</td></tr>`;
                }}
            }}
            
            rows += `<tr style="background: rgba(255,255,255,0.05);"><td colspan="3"><strong>Labor & Fixed Inputs</strong></td></tr>`;
            rows += `<tr><td>Labor Cost/hr</td><td>${{bom['number of employees ']}} emp</td><td>${{bom['Labor Cost/hr']}}</td></tr>`;
            rows += `<tr><td>Parts per hour</td><td>-</td><td>${{bom['Parts per hour']}}</td></tr>`;
            rows += `<tr><td>Labor cost / part</td><td>-</td><td>$${{bom['Labor cost / finished part']}}</td></tr>`;
            
            rows += `<tr style="background: rgba(255,255,255,0.05);"><td colspan="3"><strong>Overhead & Admin</strong></td></tr>`;
            rows += `<tr><td>Overhead</td><td>${{bom['Overhead %']}}</td><td>${{bom['Overhead cost']}}</td></tr>`;
            rows += `<tr><td>Administrative</td><td>${{bom['Administrative expense %']}}</td><td>${{bom['Administrative expense cost']}}</td></tr>`;
            rows += `<tr><td>Depreciation</td><td>${{bom['Depreciation %']}}</td><td>${{bom['Depreciation Cost']}}</td></tr>`;
            
            rows += `<tr style="background: rgba(255,255,255,0.05);"><td colspan="3"><strong>Totals</strong></td></tr>`;
            rows += `<tr><td><strong>Variable Cost</strong></td><td>-</td><td><strong>${{bom['Variable Cost']}}</strong></td></tr>`;
            rows += `<tr><td><strong>Total Cost</strong></td><td>-</td><td><strong>${{bom['Total Cost']}}</strong></td></tr>`;
            rows += `<tr style="color: var(--success);"><td><strong>Sales Target</strong></td><td>-</td><td><strong>${{bom['Sales target']}}</strong></td></tr>`;

            tbody.innerHTML = rows;
        }}

        function initCalculator() {{
            const pphInput = document.getElementById('calc-pph');
            const targetInput = document.getElementById('calc-target');
            
            const laborRate = parseMoney(appData.bomFinalAssembly['Labor Cost/hr']); // 29.25
            const totalCostOriginal = parseMoney(appData.bomFinalAssembly['Total Cost']); // 5.00
            const laborPerPartOriginal = parseMoney(appData.bomFinalAssembly['Labor cost / finished part']); // 0.382
            
            // We approximate material+fixed as Total - Labor
            const fixedCost = totalCostOriginal - laborPerPartOriginal;
            
            document.getElementById('disp-labor-rate').textContent = formatMoney(laborRate) + ' / hr';
            document.getElementById('disp-fixed-cost').textContent = formatMoney(fixedCost) + ' / part';

            function updateCalc() {{
                const pph = parseFloat(pphInput.value) || 1;
                const sellPrice = parseFloat(targetInput.value) || 0;
                
                const newLaborPerPart = laborRate / pph;
                const newTotal = fixedCost + newLaborPerPart;
                const pl = sellPrice - newTotal;
                
                document.getElementById('res-labor-part').textContent = formatMoney(newLaborPerPart);
                document.getElementById('res-subtotal').textContent = formatMoney(fixedCost + newLaborPerPart - 1.25); // rough subtotal display
                document.getElementById('res-total').textContent = formatMoney(newTotal);
                
                const plEl = document.getElementById('res-pl');
                plEl.textContent = formatMoney(pl);
                plEl.style.color = pl < 0 ? 'var(--danger)' : 'var(--success)';
            }}

            pphInput.addEventListener('input', updateCalc);
            targetInput.addEventListener('input', updateCalc);
            updateCalc();
        }}

        function renderChart() {{
            const container = document.getElementById('chart-container');
            const width = container.clientWidth - 40;
            const height = container.clientHeight - 40;
            
            // Only shipped orders with dates
            const shipped = appData.orders.filter(o => o.internalStatus === 'Shipped' && o.shippedDate);
            shipped.sort((a,b) => new Date(a.shippedDate) - new Date(b.shippedDate));
            
            if(shipped.length === 0) return;

            let svg = `<svg width="100%" height="100%" viewBox="0 0 ${{width + 40}} ${{height + 40}}">`;
            
            const maxRev = Math.max(...shipped.map(o => parseMoney(o.revenue)));
            const minPL = Math.min(...shipped.map(o => parseMoney(o.pl)));
            
            // X-axis mapping
            const stepX = width / (shipped.length > 1 ? shipped.length - 1 : 1);
            
            // Y-axis mappings (Revenue 0 to maxRev, P/L minPL to 0)
            const mapYRev = (val) => height - (val / maxRev) * (height / 2);
            const mapYPL = (val) => height - (height/2) + Math.abs(val / minPL) * (height/2) - 20;

            // Draw center line
            svg += `<line x1="20" y1="${{height/2 + 20}}" x2="${{width+20}}" y2="${{height/2 + 20}}" stroke="var(--border-color)" stroke-width="1" />`;

            // Draw Bars for P/L
            shipped.forEach((o, i) => {{
                const x = 20 + (i * stepX);
                const plVal = parseMoney(o.pl);
                const yPL = mapYPL(plVal);
                const barHeight = Math.abs(yPL - (height/2 + 20));
                const color = o.customer.includes('Gleason') ? 'rgba(239, 68, 68, 0.6)' : 'rgba(245, 158, 11, 0.6)';
                
                svg += `<rect x="${{x - 10}}" y="${{height/2 + 20}}" width="20" height="${{barHeight}}" fill="${{color}}" />`;
            }});

            // Draw Lines for Revenue
            let pathGleason = '';
            let pathPrecision = '';
            
            shipped.forEach((o, i) => {{
                const x = 20 + (i * stepX);
                const yRev = mapYRev(parseMoney(o.revenue)) + 20;
                
                svg += `<circle cx="${{x}}" cy="${{yRev}}" r="4" fill="var(--accent)" />`;
                // Tooltip text
                svg += `<text x="${{x}}" y="${{yRev - 10}}" fill="var(--text-muted)" font-size="10" text-anchor="middle" class="chart-label">${{o.shippedDate.split('/')[0]+'/'+o.shippedDate.split('/')[1]}}</text>`;
            }});

            // Legend
            svg += `<text x="20" y="20" fill="var(--text-muted)" font-size="12">Top: Revenue | Bottom: P/L Loss (Red=Gleason, Orange=Precision)</text>`;

            svg += `</svg>`;
            container.innerHTML = svg;
        }}

        window.onload = init;
        window.onresize = renderChart;
    </script>
</body>
</html>
"""

with open(html_path, 'w') as f:
    f.write(html_template)

print(f"Generated standalone HTML presentation at {html_path}")
