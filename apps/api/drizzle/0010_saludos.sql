CREATE TYPE "public"."greeting_status" AS ENUM('pending', 'accepted', 'declined');--> statement-breakpoint
CREATE TABLE "nearby_greetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"status" "greeting_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "nearby_greetings" ADD CONSTRAINT "nearby_greetings_from_id_users_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nearby_greetings" ADD CONSTRAINT "nearby_greetings_to_id_users_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nearby_greetings_pair_idx" ON "nearby_greetings" USING btree ("from_id","to_id");--> statement-breakpoint
CREATE INDEX "nearby_greetings_to_idx" ON "nearby_greetings" USING btree ("to_id","status");--> statement-breakpoint
CREATE INDEX "nearby_greetings_from_created_idx" ON "nearby_greetings" USING btree ("from_id","created_at");