import { app } from "./app.ts";
import { seed } from "./seed.ts";

await seed();
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`listening on http://localhost:${port}`);
  console.log(`try: curl -H 'Authorization: Bearer vic' http://localhost:${port}/projects/acme-dashboard/password-protection`);
  console.log(`     curl http://localhost:${port}/sites/dashboard.acme.com`);
});
