CREATE TABLE "shift_cycles" (
	"id" serial PRIMARY KEY NOT NULL,
	"shift_id" integer NOT NULL,
	"cycle_date" varchar(10) NOT NULL,
	"status" varchar(20) DEFAULT 'OPEN' NOT NULL,
	"declared_number" varchar(10),
	"total_collected" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"total_payout" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shift_cycles" ADD CONSTRAINT "shift_cycles_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_shift_cycle" ON "shift_cycles" USING btree ("shift_id","cycle_date");
