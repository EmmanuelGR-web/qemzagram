CREATE TYPE "public"."status_audience" AS ENUM('contacts', 'except', 'only');--> statement-breakpoint
CREATE TYPE "public"."status_audience_list" AS ENUM('except', 'only');--> statement-breakpoint
CREATE TABLE "status_audience_members" (
	"owner_id" uuid NOT NULL,
	"list" "status_audience_list" NOT NULL,
	"member_id" uuid NOT NULL,
	CONSTRAINT "status_audience_members_owner_id_list_member_id_pk" PRIMARY KEY("owner_id","list","member_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status_audience" "status_audience" DEFAULT 'contacts' NOT NULL;--> statement-breakpoint
ALTER TABLE "status_audience_members" ADD CONSTRAINT "status_audience_members_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_audience_members" ADD CONSTRAINT "status_audience_members_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;