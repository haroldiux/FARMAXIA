CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" varchar(100) NOT NULL,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"operation" varchar(100) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"status_code" integer NOT NULL,
	"response_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"aggregate_type" varchar(100) NOT NULL,
	"aggregate_id" varchar(100) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"document_type" varchar(50) NOT NULL,
	"current_number" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_tenant_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_tenant_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_tenant_branch_occurred_at_idx" ON "audit_events" USING btree ("tenant_id","branch_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_tenant_op_key_unique" ON "idempotency_records" USING btree ("tenant_id","operation","idempotency_key");--> statement-breakpoint
CREATE INDEX "outbox_events_tenant_branch_status_scheduled_idx" ON "outbox_events" USING btree ("tenant_id","branch_id","status","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "document_sequences_tenant_branch_type_unique" ON "document_sequences" USING btree ("tenant_id","branch_id","document_type");--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE audit_events TO farmaxia_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE idempotency_records TO farmaxia_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE outbox_events TO farmaxia_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE document_sequences TO farmaxia_app;--> statement-breakpoint
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY audit_events_branch_isolation ON audit_events
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = audit_events.tenant_id
        AND membership.branch_id = audit_events.branch_id
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = audit_events.tenant_id
        AND membership.branch_id = audit_events.branch_id
    )
  );--> statement-breakpoint
ALTER TABLE idempotency_records ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE idempotency_records FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY idempotency_records_branch_isolation ON idempotency_records
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = idempotency_records.tenant_id
        AND membership.branch_id = idempotency_records.branch_id
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = idempotency_records.tenant_id
        AND membership.branch_id = idempotency_records.branch_id
    )
  );--> statement-breakpoint
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY outbox_events_branch_isolation ON outbox_events
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = outbox_events.tenant_id
        AND membership.branch_id = outbox_events.branch_id
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = outbox_events.tenant_id
        AND membership.branch_id = outbox_events.branch_id
    )
  );--> statement-breakpoint
ALTER TABLE document_sequences ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE document_sequences FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY document_sequences_branch_isolation ON document_sequences
  FOR ALL TO farmaxia_app
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = document_sequences.tenant_id
        AND membership.branch_id = document_sequences.branch_id
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND branch_id = NULLIF(current_setting('app.branch_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM user_branch_memberships AS membership
      WHERE membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND membership.tenant_id = document_sequences.tenant_id
        AND membership.branch_id = document_sequences.branch_id
    )
  );--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_audit_events_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit events are immutable and append-only, cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_audit_events_immutable
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_events_mutation();
