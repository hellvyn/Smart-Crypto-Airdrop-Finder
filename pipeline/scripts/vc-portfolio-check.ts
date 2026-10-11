// Manual check of the VC portfolio pages in VC_LIST (curation plan 5 Task 4, step 3): fetches each page once with the
// pipeline's HTTP client and prints its status and the portfolio domains found in its HTML. A VC with status other
// than 200, no domains (page rendered by JavaScript) or domains that are not portfolio companies is struck from
// VC_LIST and recorded in docs/ops/pipeline.md ("Daftar VC"). Reads public pages only; writes nothing.
// Usage: pnpm --filter pipeline exec tsx scripts/vc-portfolio-check.ts
import { VC_LIST } from "../src/config.js";
import { parsePortfolioDomains } from "../src/enrich/vc-portfolios.js";
import { createHttp } from "../src/http.js";

const http = createHttp();
for (const vc of VC_LIST) {
  const res = await http.get(vc.portfolioUrl);
  const domains = res.status === 200 ? parsePortfolioDomains(res.body, vc) : [];
  console.log(`${vc.id}\tstatus=${res.status}\tdomains=${domains.length}\t${vc.portfolioUrl}`);
  if (domains.length > 0) console.log(`  ${domains.join(" ")}`);
}
