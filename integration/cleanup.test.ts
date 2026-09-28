// Runs the orphaned-file cleanup against local Supabase. The test moves the cutoff
// instead of backdating files, since storage.objects is not reachable through the API.
// It deletes every orphan in the local bucket, so do not run it during a browser test.
import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { runCleanup } from "@/lib/cleanup";
import type { Database } from "@/lib/database.types";

vi.mock("server-only", () => ({}));

process.loadEnvFile(".env.local");
const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});

// throwOnError() types each row as present; a generic { data, error } helper infers null into .single() rows.
it("deletes stored files that no item points to, and keeps registered ones", async () => {
  const tag = Math.random().toString(36).slice(2, 8);
  const { data: firm } = await admin
    .from("firms")
    .insert({ name: `Cleanup ${tag}` })
    .select("id")
    .single()
    .throwOnError();
  const { data: client } = await admin
    .from("clients")
    .insert({ firm_id: firm.id, name: "Cleanup client" })
    .select("id")
    .single()
    .throwOnError();
  const { data: request } = await admin
    .from("requests")
    .insert({ firm_id: firm.id, client_id: client.id, title: "Cleanup", due_date: "2031-01-01", status: "open" })
    .select("id")
    .single()
    .throwOnError();
  const { data: item } = await admin
    .from("request_items")
    .insert({ request_id: request.id, firm_id: firm.id, position: 1, title: "File", kind: "file" })
    .select("id")
    .single()
    .throwOnError();
  const folder = `${firm.id}/${client.id}/${item.id}`;
  for (const name of ["kept.pdf", "orphan.pdf"]) {
    const { error } = await admin.storage
      .from("documents")
      .upload(`${folder}/${name}`, new Blob(["%PDF-1.4"], { type: "application/pdf" }), { contentType: "application/pdf" });
    if (error) throw error;
  }
  await admin
    .from("item_files")
    .insert({
      item_id: item.id,
      firm_id: firm.id,
      storage_path: `${folder}/kept.pdf`,
      filename: "kept.pdf",
      size_bytes: 8,
      mime: "application/pdf",
    })
    .throwOnError();

  const names = async () => {
    const { data, error } = await admin.storage.from("documents").list(folder);
    if (error) throw error;
    return data.map((file) => file.name);
  };

  // The default cutoff keeps a fresh orphan: its upload may still be in progress.
  await runCleanup(admin, { maxRows: 100_000 });
  expect(await names()).toEqual(["kept.pdf", "orphan.pdf"]);

  const summary = await runCleanup(admin, { olderThan: "0 seconds", maxRows: 100_000 });

  expect(summary.failed).toBe(0);
  expect(summary.deleted).toBeGreaterThanOrEqual(1);
  expect(await names()).toEqual(["kept.pdf"]);
  // The stored bytes are gone too, not only the listing.
  expect((await admin.storage.from("documents").download(`${folder}/kept.pdf`)).error).toBeNull();
  expect((await admin.storage.from("documents").download(`${folder}/orphan.pdf`)).error).not.toBeNull();
});

it("expires files past the firm's retention period", async () => {
  const tag = Math.random().toString(36).slice(2, 8);
  const { data: firm } = await admin
    .from("firms")
    .insert({ name: `Retention ${tag}`, file_retention_years: 1 })
    .select("id")
    .single()
    .throwOnError();
  const { data: client } = await admin
    .from("clients")
    .insert({ firm_id: firm.id, name: "Retention client" })
    .select("id")
    .single()
    .throwOnError();

  const created: { id: string; folder: string; fileId: string; name: string }[] = [];
  for (const name of ["expired", "recent"]) {
    const { data: request } = await admin
      .from("requests")
      .insert({ firm_id: firm.id, client_id: client.id, title: name, due_date: "2031-01-01", status: "open" })
      .select("id")
      .single()
      .throwOnError();
    const { data: item } = await admin
      .from("request_items")
      .insert({ request_id: request.id, firm_id: firm.id, position: 1, title: name, kind: "file" })
      .select("id")
      .single()
      .throwOnError();
    const folder = `${firm.id}/${client.id}/${item.id}`;
    const { error } = await admin.storage
      .from("documents")
      .upload(`${folder}/${name}.pdf`, new Blob(["%PDF-1.4"], { type: "application/pdf" }), {
        contentType: "application/pdf",
      });
    if (error) throw error;
    const { data: file } = await admin
      .from("item_files")
      .insert({
        item_id: item.id,
        firm_id: firm.id,
        storage_path: `${folder}/${name}.pdf`,
        filename: `${name}.pdf`,
        size_bytes: 8,
        mime: "application/pdf",
      })
      .select("id")
      .single()
      .throwOnError();
    created.push({ id: request.id, folder, fileId: file.id, name });
  }

  await admin.from("requests").update({ status: "archived" }).in("id", created.map((r) => r.id)).throwOnError();
  await admin
    .from("requests")
    .update({ archived_at: new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString() })
    .eq("id", created[0].id)
    .throwOnError();

  const summary = await runCleanup(admin, { olderThan: "0 seconds", maxRows: 100_000 });

  expect(summary.expired).toBeGreaterThanOrEqual(1);
  const [old, recent] = created;
  expect((await admin.from("item_files").select("id").eq("id", old.fileId).maybeSingle()).data).toBeNull();
  expect((await admin.storage.from("documents").download(`${old.folder}/${old.name}.pdf`)).error).not.toBeNull();
  expect((await admin.storage.from("documents").download(`${recent.folder}/${recent.name}.pdf`)).error).toBeNull();
});
