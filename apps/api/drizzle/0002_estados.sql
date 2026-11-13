CREATE TYPE "public"."status_kind" AS ENUM('text', 'image', 'video');--> statement-breakpoint
CREATE TABLE "statuses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" "status_kind" NOT NULL,
	"body_encrypted" text NOT NULL,
	"background" text,
	"storage_key" text,
	"mime_type" text,
	"size_bytes" integer,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "statuses_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "statuses" ADD CONSTRAINT "statuses_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "statuses_owner_expires_idx" ON "statuses" USING btree ("owner_id","expires_at");--> statement-breakpoint
CREATE INDEX "statuses_expires_idx" ON "statuses" USING btree ("expires_at");