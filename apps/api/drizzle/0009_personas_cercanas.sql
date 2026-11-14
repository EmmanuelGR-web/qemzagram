CREATE TABLE "nearby_presence" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"cell_row" integer,
	"cell_col" integer,
	"visible_until" timestamp with time zone,
	"cell_changed_at" timestamp with time zone,
	"changes_window_start" timestamp with time zone,
	"changes_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nearby_presence" ADD CONSTRAINT "nearby_presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nearby_presence_cell_idx" ON "nearby_presence" USING btree ("cell_row","cell_col");--> statement-breakpoint
CREATE INDEX "nearby_presence_until_idx" ON "nearby_presence" USING btree ("visible_until");