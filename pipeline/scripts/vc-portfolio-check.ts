// Manual check of the VC portfolio pages (curation plan 5 Task 4, step 3): fetches each page of VC_LIST (verified) and
// VC_CANDIDATES (not yet verified) once with the pipeline's HTTP client and prints its status and the portfolio
// domains found in its HTML. A candidate with status 200 whose domains are its portfolio companies moves to VC_LIST;
// one with another status, no domains (page rendered by JavaScript) or domains that are not portfolio companies is
// struck. Either way it is recorded in docs/ops/pipeline.md ("Daftar VC"). Reads public pages only; writes nothing.
// Usage: pnpm --filter pipeline exec tsx scripts/vc-portfolio-check.ts
import { VC_CANDIDATES, VC_LIST } from "../src/config.js";
import { parsePortfolioDomains } from "../src/enrich/vc-portfolios.js";
import { createHttp } from "../src/http.js";

const http = createHttp();
for (const [list, vcs] of [["verified", VC_LIST], ["candidate", VC_CANDIDATES]] as const) {
  for (const vc of vcs) {
    const res = await http.get(vc.portfolioUrl);
    const domains = res.status === 200 ? parsePortfolioDomains(res.body, vc) : [];
    console.log(`${list}\t${vc.id}\tstatus=${res.status}\tdomains=${domains.length}\t${vc.portfolioUrl}`);
    if (domains.length > 0) console.log(`  ${domains.join(" ")}`);
  }
}
