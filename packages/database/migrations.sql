-- PB Exchange — full schema migration (generated from packages/database/src/migrate.ts)
-- Idempotent: every statement is CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- No DROP, no DELETE — existing data is untouched. Take a backup before running anyway.
--   psql "$DATABASE_URL" -f migrations.sql
    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) NOT NULL UNIQUE,
      description TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(60) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role_id INTEGER NOT NULL REFERENCES roles(id),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_login_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS blocked_ips (
      id SERIAL PRIMARY KEY,
      ip_address VARCHAR(45) NOT NULL UNIQUE,
      reason TEXT,
      blocked_by INTEGER NOT NULL REFERENCES users(id),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      unblocked_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      open_date VARCHAR(10) NOT NULL,
      is_next_day BOOLEAN NOT NULL DEFAULT FALSE,
      status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
      declared_number VARCHAR(10),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS shifts_date_idx ON shifts(open_date, status);
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS shift_for VARCHAR(20) NOT NULL DEFAULT 'BOTH';
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100) NOT NULL DEFAULT 'A100';
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
    -- Edit Shift popup's Time/Config/Company Config/Enable-Disable tabs
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS fanter_panel_time VARCHAR(8) NOT NULL DEFAULT '00:00:00';
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS main_jantri_time VARCHAR(8) NOT NULL DEFAULT '00:00:00';
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS apply_shift_config BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS d_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS d_commission NUMERIC(5, 2) NOT NULL DEFAULT 0.00;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS a_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS a_commission NUMERIC(5, 2) NOT NULL DEFAULT 0.00;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS tax NUMERIC(5, 2) NOT NULL DEFAULT 0.00;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS transaction_capping BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS collection_round_off NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS check_lagai_before_declare BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS create_vapsi BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS result_web_shift_id INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS auto_company_transaction_active BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS company_url VARCHAR(255) NOT NULL DEFAULT '';
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS company_shift_id INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS company_username VARCHAR(100) NOT NULL DEFAULT '';
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS company_password VARCHAR(100) NOT NULL DEFAULT '';
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS company_d_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS company_d_comm NUMERIC(5, 2) NOT NULL DEFAULT 0.00;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS company_a_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS company_a_comm NUMERIC(5, 2) NOT NULL DEFAULT 0.00;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS company_tax NUMERIC(5, 2) NOT NULL DEFAULT 0.00;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS company_remark VARCHAR(255) NOT NULL DEFAULT '';

    CREATE TABLE IF NOT EXISTS shift_role_config (
      id SERIAL PRIMARY KEY,
      shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      role_id INTEGER NOT NULL REFERENCES roles(id),
      open_time VARCHAR(8) NOT NULL,
      close_time VARCHAR(8) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      CONSTRAINT unique_shift_role UNIQUE(shift_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS operator_shift_permissions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      shift_id INTEGER NOT NULL REFERENCES shifts(id),
      shift_date VARCHAR(10) NOT NULL,
      can_allow BOOLEAN NOT NULL DEFAULT TRUE,
      can_add BOOLEAN NOT NULL DEFAULT TRUE,
      can_edit BOOLEAN NOT NULL DEFAULT FALSE,
      can_delete BOOLEAN NOT NULL DEFAULT FALSE,
      can_export BOOLEAN NOT NULL DEFAULT FALSE,
      data_scope VARCHAR(10) NOT NULL DEFAULT 'SELF',
      expires_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS shift_cycles (
      id SERIAL PRIMARY KEY,
      shift_id INTEGER NOT NULL REFERENCES shifts(id),
      cycle_date VARCHAR(10) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
      declared_number VARCHAR(10),
      total_collected NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
      total_payout NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_shift_cycle UNIQUE(shift_id, cycle_date)
    );

    CREATE TABLE IF NOT EXISTS agents (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      agent_name VARCHAR(100) NOT NULL,
      parent_agent_id INTEGER,
      commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
      hissa_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
      contact_number VARCHAR(20),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS main_agent_name VARCHAR(100);
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS parent_agent_name VARCHAR(100);
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS updated_by VARCHAR(50) NOT NULL DEFAULT 'A100';
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

    CREATE TABLE IF NOT EXISTS ledgers (
      id SERIAL PRIMARY KEY,
      party_name VARCHAR(100) NOT NULL UNIQUE,
      real_name VARCHAR(100),
      group_name VARCHAR(100),
      agent_id INTEGER REFERENCES agents(id),
      distributor_id INTEGER,
      telegram VARCHAR(100),
      mobile VARCHAR(20),
      dara_rate NUMERIC(8, 2) NOT NULL DEFAULT 90.00,
      akhar_rate NUMERIC(8, 2) NOT NULL DEFAULT 9.00,
      commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
      hissa_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
      bet_limit NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
      capping NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
      is_locked BOOLEAN NOT NULL DEFAULT FALSE,
      is_risky BOOLEAN NOT NULL DEFAULT FALSE,
      deleted_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    -- ledgers pre-existed before the Ledger Update popup's Info tab was added, so its new
    -- fields are added via ALTER rather than the CREATE TABLE IF NOT EXISTS above.
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS retailer_id INTEGER;
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS ref_ledger_id INTEGER;
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS hp_ledger_id INTEGER;
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS address VARCHAR(255) DEFAULT '';
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS grantor VARCHAR(255) DEFAULT '';
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS dealing VARCHAR(20) DEFAULT 'DAILY';
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS rebate NUMERIC(5, 2) NOT NULL DEFAULT 0.00;
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS dibba BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS d_amt NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS user_name VARCHAR(50);
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS vapsi_tpr VARCHAR(50) NOT NULL DEFAULT '10 | NO';
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS has_limit BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100) NOT NULL DEFAULT 'A100';
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
    -- Ledger Update popup's Password/Account/Re-Config tabs
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS password VARCHAR(100) NOT NULL DEFAULT '123456';
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS master_ledger_config BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS is_transaction_allow BOOLEAN NOT NULL DEFAULT TRUE;

    CREATE TABLE IF NOT EXISTS ledger_third_party_links (
      id SERIAL PRIMARY KEY,
      ledger_id INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
      link_type VARCHAR(10) NOT NULL,
      party_name VARCHAR(100) NOT NULL,
      percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
      d_comm NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
      a_comm NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ledger_tp_links_ledger_idx ON ledger_third_party_links(ledger_id, link_type);

    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      slip_number VARCHAR(40) NOT NULL UNIQUE,
      shift_id INTEGER NOT NULL REFERENCES shifts(id),
      party_id INTEGER NOT NULL REFERENCES ledgers(id),
      total_amount NUMERIC(14, 2) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      idempotency_key VARCHAR(64) UNIQUE,
      is_audited BOOLEAN NOT NULL DEFAULT FALSE,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS rate_str VARCHAR(50) DEFAULT '90/10-9/10';
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS uj_type VARCHAR(10) DEFAULT 'J';
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS added_by VARCHAR(50) DEFAULT 'SYSTEM';
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_by VARCHAR(50) DEFAULT 'SYSTEM';
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_d BOOLEAN DEFAULT TRUE;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS audit_status VARCHAR(20) DEFAULT 'NOT-AUDIT';
    CREATE INDEX IF NOT EXISTS trans_party_shift_idx ON transactions(shift_id, party_id, status);
    CREATE INDEX IF NOT EXISTS trans_created_idx ON transactions(created_at);

    CREATE TABLE IF NOT EXISTS transaction_entries (
      id SERIAL PRIMARY KEY,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      entry_type VARCHAR(20) NOT NULL,
      number_value VARCHAR(4) NOT NULL,
      amount NUMERIC(12, 2) NOT NULL,
      rate NUMERIC(8, 2) NOT NULL,
      calculated_payout NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS entry_trans_num_idx ON transaction_entries(transaction_id, number_value);
    CREATE INDEX IF NOT EXISTS entry_number_val_idx ON transaction_entries(number_value);

    CREATE TABLE IF NOT EXISTS duplicate_reviews (
      id SERIAL PRIMARY KEY,
      original_transaction_id INTEGER NOT NULL REFERENCES transactions(id),
      duplicate_transaction_id INTEGER NOT NULL REFERENCES transactions(id),
      similarity_score NUMERIC(5, 2) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS declarations (
      id SERIAL PRIMARY KEY,
      shift_id INTEGER NOT NULL REFERENCES shifts(id),
      winning_number VARCHAR(10) NOT NULL,
      total_collected NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
      total_payout NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
      net_profit_loss NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
      declared_by INTEGER NOT NULL REFERENCES users(id),
      declared_at TIMESTAMP NOT NULL DEFAULT NOW(),
      is_reversed BOOLEAN NOT NULL DEFAULT FALSE,
      reversed_by INTEGER REFERENCES users(id),
      reversed_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vouchers (
      id SERIAL PRIMARY KEY,
      voucher_number VARCHAR(40) NOT NULL UNIQUE,
      voucher_type VARCHAR(30) NOT NULL,
      shift_id INTEGER REFERENCES shifts(id),
      total_amount NUMERIC(14, 2) NOT NULL,
      narration TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    -- vouchers pre-existed before audit-status/manual-voucher support was added, so new
    -- columns are added via ALTER rather than the CREATE TABLE IF NOT EXISTS above.
    ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS audit_status VARCHAR(20) NOT NULL DEFAULT 'FOR_AUDIT';
    ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS updated_by VARCHAR(50) DEFAULT 'SYSTEM';
    ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

    CREATE TABLE IF NOT EXISTS voucher_entries (
      id SERIAL PRIMARY KEY,
      voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
      ledger_id INTEGER NOT NULL REFERENCES ledgers(id),
      entry_side VARCHAR(2) NOT NULL,
      amount NUMERIC(14, 2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS staff (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      full_name VARCHAR(100) NOT NULL,
      mobile VARCHAR(20),
      designation VARCHAR(50) NOT NULL,
      monthly_salary NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
      is_working_live BOOLEAN NOT NULL DEFAULT FALSE,
      assigned_station VARCHAR(50),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE staff ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'TALLY OPERATOR';
    ALTER TABLE staff ADD COLUMN IF NOT EXISTS username VARCHAR(50) DEFAULT 'NONE';
    ALTER TABLE staff ADD COLUMN IF NOT EXISTS password VARCHAR(100) DEFAULT '123456';
    ALTER TABLE staff ADD COLUMN IF NOT EXISTS w_mode VARCHAR(50) DEFAULT 'NONE';
    ALTER TABLE staff ADD COLUMN IF NOT EXISTS address VARCHAR(255) DEFAULT '';
    ALTER TABLE staff ADD COLUMN IF NOT EXISTS agent VARCHAR(100) DEFAULT '';
    ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE staff ADD COLUMN IF NOT EXISTS updated_by VARCHAR(50) DEFAULT 'A100';
    ALTER TABLE staff ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
    ALTER TABLE staff ADD COLUMN IF NOT EXISTS salary_structure JSONB DEFAULT '{"earnings":[],"deductions":[]}'::jsonb;

    CREATE TABLE IF NOT EXISTS staff_assets (
      id SERIAL PRIMARY KEY,
      staff_id INTEGER NOT NULL REFERENCES staff(id),
      asset_name VARCHAR(100) NOT NULL,
      serial_number VARCHAR(100),
      assigned_date TIMESTAMP NOT NULL DEFAULT NOW(),
      return_date TIMESTAMP,
      notes TEXT
    );
    ALTER TABLE staff_assets ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00;
    ALTER TABLE staff_assets ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'Issue';
    ALTER TABLE staff_assets ADD COLUMN IF NOT EXISTS brand VARCHAR(100) NOT NULL DEFAULT '';
    ALTER TABLE staff_assets ADD COLUMN IF NOT EXISTS remark VARCHAR(255) NOT NULL DEFAULT '';
    ALTER TABLE staff_assets ADD COLUMN IF NOT EXISTS updated_by VARCHAR(50) NOT NULL DEFAULT 'A100';
    ALTER TABLE staff_assets ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      actor_id INTEGER NOT NULL REFERENCES users(id),
      action VARCHAR(50) NOT NULL,
      entity_type VARCHAR(50) NOT NULL,
      entity_id VARCHAR(50) NOT NULL,
      before_data JSONB,
      after_data JSONB,
      ip_address VARCHAR(45),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_logs(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS audit_actor_idx ON audit_logs(actor_id);
    CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_logs(created_at);

    CREATE TABLE IF NOT EXISTS role_messages (
      id SERIAL PRIMARY KEY,
      role_id INTEGER NOT NULL UNIQUE REFERENCES roles(id),
      message TEXT NOT NULL DEFAULT '',
      flash_message TEXT NOT NULL DEFAULT '',
      updated_by VARCHAR(50) NOT NULL DEFAULT 'A100',
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS staff_leaves (
      id SERIAL PRIMARY KEY,
      staff_id INTEGER NOT NULL REFERENCES staff(id),
      leave_from VARCHAR(10) NOT NULL,
      leave_to VARCHAR(10) NOT NULL,
      l_type VARCHAR(20) NOT NULL DEFAULT 'ABSENT',
      remark VARCHAR(255) DEFAULT '',
      updated_by VARCHAR(50) NOT NULL DEFAULT 'A100',
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS staff_attendance (
      id SERIAL PRIMARY KEY,
      staff_id INTEGER NOT NULL REFERENCES staff(id),
      month VARCHAR(7) NOT NULL,
      t_days INTEGER NOT NULL DEFAULT 0,
      present INTEGER NOT NULL DEFAULT 0,
      pay_leave INTEGER NOT NULL DEFAULT 0,
      t_count NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
      updated_by VARCHAR(50) NOT NULL DEFAULT 'A100',
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_staff_attendance_month UNIQUE(staff_id, month)
    );

    CREATE TABLE IF NOT EXISTS salary_register (
      id SERIAL PRIMARY KEY,
      staff_id INTEGER NOT NULL REFERENCES staff(id),
      month VARCHAR(7) NOT NULL,
      monthly_salary NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
      present_days INTEGER NOT NULL DEFAULT 0,
      pay_leave_days INTEGER NOT NULL DEFAULT 0,
      t_days INTEGER NOT NULL DEFAULT 0,
      net_salary NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      paid_at TIMESTAMP,
      updated_by VARCHAR(50) NOT NULL DEFAULT 'A100',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_staff_salary_month UNIQUE(staff_id, month)
    );
  
