-- Marketplace (services): delivery files on an order.
--
-- The seller attaches the finished work (a PDF, a ZIP, a document) when delivering;
-- both parties download it from the order page. Files are validated and stored
-- through @campusos/media (magic-byte allowlist, served Content-Disposition
-- attachment); this table holds the object key and the display name.
--
-- Private to the two parties, like the order itself: a party reads the files of an
-- order they are on, and the seller inserts a file onto their own order while it is
-- in progress or delivered. No definer is needed -- both recipients are parties of
-- the order, readable through the order's own party policy -- so the table is FORCE.

CREATE TABLE "mkt_order_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"order_id" uuid NOT NULL REFERENCES "mkt_orders"("id") ON DELETE CASCADE,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"uploaded_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "mkt_order_files_order_idx" ON "mkt_order_files" ("order_id", "created_at");
--> statement-breakpoint

ALTER TABLE "mkt_order_files" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A party of the order reads its files.
CREATE POLICY "mkt_order_files_party" ON "mkt_order_files" FOR SELECT
	USING (
		"tenant_id" = current_setting('app.tenant_id', true)
		AND EXISTS (
			SELECT 1 FROM mkt_orders o
			WHERE o.id = "order_id"
			  AND o.tenant_id = current_setting('app.tenant_id', true)
			  AND (
				o.buyer_id::text = current_setting('app.user_id', true)
				OR o.seller_id::text = current_setting('app.user_id', true)
			  )
		)
	);
--> statement-breakpoint
-- Only the seller uploads, onto their own order, while it is in progress or
-- delivered, and only as themselves.
CREATE POLICY "mkt_order_files_seller_insert" ON "mkt_order_files" AS RESTRICTIVE FOR INSERT
	WITH CHECK (
		"uploaded_by"::text = current_setting('app.user_id', true)
		AND EXISTS (
			SELECT 1 FROM mkt_orders o
			WHERE o.id = "order_id"
			  AND o.tenant_id = current_setting('app.tenant_id', true)
			  AND o.seller_id::text = current_setting('app.user_id', true)
			  AND o.status IN ('in_progress', 'delivered')
		)
	);
--> statement-breakpoint
-- The permissive insert half: a party may insert in their tenant (the RESTRICTIVE
-- policy narrows it to the seller on their own in-progress order).
CREATE POLICY "mkt_order_files_insert" ON "mkt_order_files" FOR INSERT
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "mkt_order_files" FORCE ROW LEVEL SECURITY;
