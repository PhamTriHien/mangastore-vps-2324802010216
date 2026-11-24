CREATE TABLE genres (
	id SERIAL NOT NULL, 
	name VARCHAR(60) NOT NULL, 
	description TEXT, 
	display_order INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE import_histories (
	id SERIAL NOT NULL, 
	batch_id VARCHAR(50) NOT NULL, 
	imported_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	imported_by VARCHAR(100), 
	product_count INTEGER NOT NULL, 
	is_zip_import BOOLEAN NOT NULL, 
	file_name VARCHAR(255), 
	is_restored BOOLEAN NOT NULL, 
	restored_at TIMESTAMP WITH TIME ZONE, 
	restored_by VARCHAR(100), 
	product_ids_json TEXT, 
	image_paths_json TEXT, 
	PRIMARY KEY (id)
);

CREATE TABLE promotions (
	code VARCHAR(50) NOT NULL, 
	display_name VARCHAR(150) NOT NULL, 
	description VARCHAR(255), 
	discount_value NUMERIC(12, 2) NOT NULL, 
	discount_type VARCHAR(20) NOT NULL, 
	max_discount NUMERIC(12, 2), 
	min_order_amount NUMERIC(12, 2), 
	total_quantity INTEGER, 
	used_quantity INTEGER NOT NULL, 
	starts_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	ends_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	applicable_role_id INTEGER, 
	PRIMARY KEY (code)
);

CREATE TABLE reader_stats (
	id SERIAL NOT NULL, 
	source_id VARCHAR(64) NOT NULL, 
	manga_id VARCHAR(255) NOT NULL, 
	read_count BIGINT NOT NULL, 
	average_rating FLOAT NOT NULL, 
	ratings_count INTEGER NOT NULL, 
	comment_count INTEGER NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_reader_stat_source_manga UNIQUE (source_id, manga_id)
);

CREATE TABLE roles (
	id SERIAL NOT NULL, 
	code VARCHAR(50) NOT NULL, 
	display_name VARCHAR(100) NOT NULL, 
	description VARCHAR(255) NOT NULL, 
	priority INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (code)
);

CREATE TABLE tags (
	id SERIAL NOT NULL, 
	name VARCHAR(60) NOT NULL, 
	description VARCHAR(255), 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE users (
	id SERIAL NOT NULL, 
	username VARCHAR(50) NOT NULL, 
	email VARCHAR(255) NOT NULL, 
	password_hash VARCHAR(255) NOT NULL, 
	phone VARCHAR(20), 
	avatar_url VARCHAR(500), 
	role_id INTEGER NOT NULL, 
	role VARCHAR(30) DEFAULT 'khach_hang' NOT NULL, 
	status VARCHAR(30) DEFAULT 'hoat_dong' NOT NULL, 
	last_login_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(role_id) REFERENCES roles (id) ON DELETE RESTRICT
);

CREATE TABLE password_reset_tokens (
	id VARCHAR(64) NOT NULL, 
	user_id INTEGER NOT NULL, 
	otp_hash VARCHAR(128) NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	is_used BOOLEAN NOT NULL, 
	ip_address VARCHAR(64), 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE products (
	id SERIAL NOT NULL, 
	title VARCHAR(200) NOT NULL, 
	author VARCHAR(120) NOT NULL, 
	publisher VARCHAR(120), 
	publication_date VARCHAR(20), 
	pages INTEGER, 
	dimensions VARCHAR(60), 
	weight VARCHAR(40), 
	language VARCHAR(50) NOT NULL, 
	isbn VARCHAR(40), 
	description TEXT NOT NULL, 
	full_description TEXT NOT NULL, 
	cover_url VARCHAR(500) NOT NULL, 
	price NUMERIC(12, 2) NOT NULL, 
	original_price NUMERIC(12, 2), 
	average_rating FLOAT NOT NULL, 
	ratings_count INTEGER NOT NULL, 
	view_count INTEGER NOT NULL, 
	units_sold INTEGER NOT NULL, 
	stock_quantity INTEGER NOT NULL, 
	status VARCHAR(30) DEFAULT 'dang_ban' NOT NULL, 
	is_featured BOOLEAN NOT NULL, 
	is_new BOOLEAN NOT NULL, 
	import_batch_id VARCHAR(50), 
	created_by INTEGER, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(created_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE reader_bookmarks (
	id SERIAL NOT NULL, 
	user_id INTEGER NOT NULL, 
	source_id VARCHAR(64) NOT NULL, 
	manga_id VARCHAR(255) NOT NULL, 
	title VARCHAR(255) NOT NULL, 
	cover_url VARCHAR(500) NOT NULL, 
	author VARCHAR(150) NOT NULL, 
	status_label VARCHAR(80) NOT NULL, 
	category VARCHAR(30) NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_reader_bookmark_user UNIQUE (user_id, source_id, manga_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE reader_comments (
	id SERIAL NOT NULL, 
	source_id VARCHAR(64) NOT NULL, 
	manga_id VARCHAR(255) NOT NULL, 
	chapter_id VARCHAR(255), 
	chapter_label VARCHAR(120), 
	user_id INTEGER NOT NULL, 
	parent_comment_id INTEGER, 
	content TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(parent_comment_id) REFERENCES reader_comments (id) ON DELETE CASCADE
);

CREATE TABLE reader_history (
	id SERIAL NOT NULL, 
	user_id INTEGER NOT NULL, 
	source_id VARCHAR(64) NOT NULL, 
	manga_id VARCHAR(255) NOT NULL, 
	title VARCHAR(255) NOT NULL, 
	cover_url VARCHAR(500) NOT NULL, 
	chapter_id VARCHAR(255) NOT NULL, 
	chapter_label VARCHAR(200) NOT NULL, 
	current_page INTEGER NOT NULL, 
	total_pages INTEGER NOT NULL, 
	language VARCHAR(16) NOT NULL, 
	read_chapters_json TEXT NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_reader_history_user UNIQUE (user_id, source_id, manga_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE reader_ratings (
	id SERIAL NOT NULL, 
	source_id VARCHAR(64) NOT NULL, 
	manga_id VARCHAR(255) NOT NULL, 
	user_id INTEGER NOT NULL, 
	score INTEGER NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_reader_rating_user UNIQUE (source_id, manga_id, user_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE search_history (
	id SERIAL NOT NULL, 
	user_id INTEGER NOT NULL, 
	keyword VARCHAR(200) NOT NULL, 
	filters_json TEXT, 
	results_count INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE shipping_addresses (
	id SERIAL NOT NULL, 
	user_id INTEGER NOT NULL, 
	full_name VARCHAR(150) NOT NULL, 
	phone_number VARCHAR(20) NOT NULL, 
	address_line VARCHAR(255) NOT NULL, 
	ward VARCHAR(100), 
	district VARCHAR(100), 
	province VARCHAR(100), 
	country VARCHAR(100) NOT NULL, 
	is_default BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE user_activities (
	id SERIAL NOT NULL, 
	user_id INTEGER NOT NULL, 
	activity_type VARCHAR(100) NOT NULL, 
	content TEXT, 
	ip_address VARCHAR(64), 
	user_agent VARCHAR(400), 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE user_notifications (
	id SERIAL NOT NULL, 
	user_id INTEGER, 
	title VARCHAR(200) NOT NULL, 
	content TEXT NOT NULL, 
	notification_type VARCHAR(100), 
	level VARCHAR(20) NOT NULL, 
	is_read BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	read_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE user_sessions (
	session_id VARCHAR(128) NOT NULL, 
	user_id INTEGER NOT NULL, 
	token_hash VARCHAR(128) NOT NULL, 
	is_persistent BOOLEAN NOT NULL, 
	ip_address VARCHAR(64), 
	user_agent VARCHAR(400), 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (session_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE cart_items (
	id SERIAL NOT NULL, 
	user_id INTEGER NOT NULL, 
	product_id INTEGER NOT NULL, 
	quantity INTEGER NOT NULL, 
	unit_price NUMERIC(12, 2) NOT NULL, 
	added_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_cart_user_product UNIQUE (user_id, product_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE CASCADE
);

CREATE TABLE chapters (
	id SERIAL NOT NULL, 
	product_id INTEGER NOT NULL, 
	chapter_number FLOAT NOT NULL, 
	title VARCHAR(255) NOT NULL, 
	content TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_product_chapter_number UNIQUE (product_id, chapter_number), 
	FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE CASCADE
);

CREATE TABLE orders (
	id SERIAL NOT NULL, 
	order_code VARCHAR(40) NOT NULL, 
	user_id INTEGER NOT NULL, 
	sub_total NUMERIC(12, 2) NOT NULL, 
	promotion_code VARCHAR(50), 
	discount_amount NUMERIC(12, 2) NOT NULL, 
	shipping_fee NUMERIC(12, 2) NOT NULL, 
	tax_amount NUMERIC(12, 2) NOT NULL, 
	grand_total NUMERIC(12, 2) NOT NULL, 
	status VARCHAR(30) NOT NULL, 
	payment_status VARCHAR(30) NOT NULL, 
	payment_method VARCHAR(30) NOT NULL, 
	momo_trans_id VARCHAR(100), 
	shipping_address_id INTEGER, 
	full_name VARCHAR(150) NOT NULL, 
	phone VARCHAR(20) NOT NULL, 
	email VARCHAR(150), 
	address VARCHAR(500) NOT NULL, 
	province VARCHAR(100), 
	district VARCHAR(100), 
	ward VARCHAR(100), 
	lat FLOAT, 
	lng FLOAT, 
	notes VARCHAR(500), 
	paid_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(promotion_code) REFERENCES promotions (code) ON DELETE SET NULL, 
	FOREIGN KEY(shipping_address_id) REFERENCES shipping_addresses (id) ON DELETE SET NULL
);

CREATE TABLE product_assets (
	id SERIAL NOT NULL, 
	product_id INTEGER NOT NULL, 
	asset_type VARCHAR(50) NOT NULL, 
	url VARCHAR(500) NOT NULL, 
	description VARCHAR(255), 
	display_order INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE CASCADE
);

CREATE TABLE product_genres (
	product_id INTEGER NOT NULL, 
	genre_id INTEGER NOT NULL, 
	PRIMARY KEY (product_id, genre_id), 
	FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE CASCADE, 
	FOREIGN KEY(genre_id) REFERENCES genres (id) ON DELETE CASCADE
);

CREATE TABLE product_tags (
	product_id INTEGER NOT NULL, 
	tag_id INTEGER NOT NULL, 
	PRIMARY KEY (product_id, tag_id), 
	FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE CASCADE, 
	FOREIGN KEY(tag_id) REFERENCES tags (id) ON DELETE CASCADE
);

CREATE TABLE reviews (
	id SERIAL NOT NULL, 
	product_id INTEGER NOT NULL, 
	user_id INTEGER NOT NULL, 
	rating INTEGER NOT NULL, 
	content TEXT, 
	is_purchased BOOLEAN NOT NULL, 
	admin_reply TEXT, 
	admin_replied_by VARCHAR(100), 
	admin_replied_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_review_user_product UNIQUE (user_id, product_id), 
	FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE CASCADE, 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE wishlists (
	id SERIAL NOT NULL, 
	user_id INTEGER NOT NULL, 
	product_id INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_wishlist_user_product UNIQUE (user_id, product_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE CASCADE
);

CREATE TABLE order_items (
	id SERIAL NOT NULL, 
	order_id INTEGER NOT NULL, 
	product_id INTEGER NOT NULL, 
	product_name VARCHAR(200) NOT NULL, 
	cover_url VARCHAR(500) NOT NULL, 
	quantity INTEGER NOT NULL, 
	unit_price NUMERIC(12, 2) NOT NULL, 
	total_price NUMERIC(12, 2) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(order_id) REFERENCES orders (id) ON DELETE CASCADE, 
	FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE RESTRICT
);

CREATE TABLE order_payments (
	id SERIAL NOT NULL, 
	order_id INTEGER NOT NULL, 
	payment_method VARCHAR(50) NOT NULL, 
	reference_code VARCHAR(120), 
	amount NUMERIC(12, 2) NOT NULL, 
	status VARCHAR(30) NOT NULL, 
	content TEXT, 
	response_data TEXT, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(order_id) REFERENCES orders (id) ON DELETE CASCADE
);

CREATE TABLE order_shipments (
	id SERIAL NOT NULL, 
	order_id INTEGER NOT NULL, 
	carrier VARCHAR(100), 
	tracking_number VARCHAR(100), 
	shipping_status VARCHAR(50), 
	shipped_at TIMESTAMP WITH TIME ZONE, 
	estimated_delivery_at TIMESTAMP WITH TIME ZONE, 
	additional_fee NUMERIC(12, 2) NOT NULL, 
	notes VARCHAR(255), 
	PRIMARY KEY (id), 
	UNIQUE (order_id), 
	FOREIGN KEY(order_id) REFERENCES orders (id) ON DELETE CASCADE
);

CREATE TABLE order_status_history (
	id SERIAL NOT NULL, 
	order_id INTEGER NOT NULL, 
	previous_status VARCHAR(30), 
	new_status VARCHAR(30) NOT NULL, 
	notes VARCHAR(255), 
	actor_id INTEGER, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(order_id) REFERENCES orders (id) ON DELETE CASCADE, 
	FOREIGN KEY(actor_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE promotion_usages (
	id SERIAL NOT NULL, 
	promotion_code VARCHAR(50) NOT NULL, 
	user_id INTEGER NOT NULL, 
	order_id INTEGER, 
	used_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_promo_usage_user UNIQUE (promotion_code, user_id), 
	FOREIGN KEY(promotion_code) REFERENCES promotions (code) ON DELETE CASCADE, 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(order_id) REFERENCES orders (id) ON DELETE SET NULL
);
