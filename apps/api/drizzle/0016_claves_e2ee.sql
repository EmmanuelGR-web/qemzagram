CREATE TABLE "e2ee_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"public_key" jsonb NOT NULL,
	"backup" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "e2ee_keys" ADD CONSTRAINT "e2ee_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "e2ee_keys_user_idx" ON "e2ee_keys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "e2ee_keys_one_active_idx" ON "e2ee_keys" USING btree ("user_id") WHERE "e2ee_keys"."revoked_at" is null;