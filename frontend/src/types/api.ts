export interface UserDto {
  id: number;
  username: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  role_id: number;
  role: string;
  status: string;
  last_login_at: string | null;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  session_id: string;
  user: UserDto;
}

export interface ClassifiedTagItem {
  id: string;
  name: string;
  display_name: string;
  group: string;
  domain: "store" | "reader";
  target_url: string;
  item_count?: number | null;
}

export interface ProductCardDto {
  id: number;
  title: string;
  author: string;
  category: string;
  genres: string[];
  tags: string[];
  price: number;
  original_price: number | null;
  average_rating: number;
  ratings_count: number;
  view_count: number;
  units_sold: number;
  stock_quantity: number;
  status: string;
  in_stock: boolean;
  is_available: boolean;
  is_featured: boolean;
  is_new: boolean;
  is_in_wishlist?: boolean;
  cover_url: string;
  description: string;
}

export interface ProductDetailDto extends ProductCardDto {
  publisher: string | null;
  publication_date: string | null;
  pages: number | null;
  dimensions: string | null;
  weight: string | null;
  language: string;
  isbn: string | null;
  full_description: string;
  gallery: string[];
  chapter_count: number;
}

export interface ReviewDto {
  id: number;
  product_id: number;
  user_id: number;
  username: string;
  avatar_url: string | null;
  rating: number;
  content: string | null;
  is_purchased: boolean;
  admin_reply: string | null;
  admin_replied_by: string | null;
  admin_replied_at: string | null;
  created_at: string;
}

export interface HomeResponse {
  popular_products: ProductCardDto[];
  hot_products: ProductCardDto[];
  new_products: ProductCardDto[];
  trending_tags: string[];
  store_tags: ClassifiedTagItem[];
  reader_tags: ClassifiedTagItem[];
  featured_reader_manga: ReaderMangaSummary[];
}

export interface ProductsListResponse {
  items: ProductCardDto[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  categories: string[];
  store_tags: ClassifiedTagItem[];
}

export interface ProductDetailResponse {
  product: ProductDetailDto;
  related_products: ProductCardDto[];
  reviews: ReviewDto[];
  can_review: boolean;
  has_reviewed: boolean;
  user_review: ReviewDto | null;
  is_in_wishlist: boolean;
}

export interface CartItemDto {
  product_id: number;
  title: string;
  cover_url: string;
  price: number;
  quantity: number;
  max_stock: number;
  status: string;
  is_available: boolean;
  subtotal: number;
}

export interface CartSummaryResponse {
  items: CartItemDto[];
  total_items: number;
  sub_total: number;
  shipping_fee: number;
  grand_total: number;
}

export interface CouponValidationResponse {
  valid: boolean;
  code: string;
  discount: number;
  shipping_fee: number;
  grand_total: number;
  message: string;
}

export interface OrderItemDto {
  product_id: number;
  product_name: string;
  cover_url: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  has_reviewed?: boolean;
}

export interface OrderDto {
  id: number;
  order_code: string;
  sub_total: number;
  promotion_code: string | null;
  discount_amount: number;
  shipping_fee: number;
  grand_total: number;
  status: string;
  payment_status: string;
  payment_method: string;
  momo_trans_id: string | null;
  full_name: string;
  phone: string;
  email: string | null;
  address: string;
  province: string | null;
  district: string | null;
  ward: string | null;
  notes: string | null;
  paid_at: string | null;
  created_at: string;
  items: OrderItemDto[];
}

export interface ShippingAddressDto {
  id: number;
  full_name: string;
  phone_number: string;
  address_line: string;
  ward: string | null;
  district: string | null;
  province: string | null;
  country: string;
  is_default: boolean;
}

export interface AddressSuggestion {
  lat: number;
  lon: number;
  display_name: string;
  short_name: string;
  type_label: string;
  house_number: string;
  road: string;
  suburb: string;
  district: string;
  city: string;
}

export interface ReaderSourceInfo {
  id: string;
  display_name: string;
  language_badge: string;
  description: string;
  is_available: boolean;
  status_message?: string | null;
  supports_demographic: boolean;
  supports_status: boolean;
  supports_sort: boolean;
}

export interface ReaderTagDto {
  id: string;
  name: string;
  vietnamese_name: string;
  group: string;
}

export interface ReaderMangaSummary {
  id: string;
  source_id: string;
  source_name: string;
  title: string;
  alt_title?: string | null;
  author: string;
  cover_url: string;
  status: string;
  status_label: string;
  language: string;
  year?: number | null;
  rating?: number | null;
  rating_max: number;
  rating_count?: number | null;
  view_count?: number | null;
  follow_count?: number | null;
  comment_count?: number | null;
  tags: string[];
}

export interface ReaderChapterDto {
  id: string;
  source_id: string;
  manga_id: string;
  chapter_number: string;
  volume_number?: string | null;
  title: string;
  display_label: string;
  language: string;
  scanlation_group?: string | null;
  page_count: number;
  published_at?: string | null;
}

export interface ReaderCommentDto {
  id: number;
  source_id: string;
  manga_id: string;
  chapter_id?: string | null;
  chapter_label?: string | null;
  user_id: number;
  username: string;
  avatar_url?: string | null;
  is_staff: boolean;
  parent_comment_id?: number | null;
  content: string;
  created_at: string;
  can_delete: boolean;
  replies: ReaderCommentDto[];
}

export interface ReaderHistoryDto {
  source_id: string;
  manga_id: string;
  title: string;
  cover_url: string;
  chapter_id: string;
  chapter_label: string;
  current_page: number;
  total_pages: number;
  language: string;
  read_chapters: string[];
  updated_at: string;
}

export interface ReaderBookmarkDto {
  source_id: string;
  manga_id: string;
  title: string;
  cover_url: string;
  author: string;
  status_label: string;
  category: "reading" | "plan" | "favorite" | "completed";
  updated_at: string;
}

export interface ReaderDetailResponse {
  manga: ReaderMangaSummary;
  description: string;
  chapters: ReaderChapterDto[];
  available_languages: string[];
  selected_language: string;
  matched_store_products: ProductCardDto[];
  local_stats: {
    read_count: number;
    average_rating: number;
    ratings_count: number;
    comment_count: number;
  };
  comments: ReaderCommentDto[];
  user_rating: number | null;
  bookmark_category: string | null;
  last_history: ReaderHistoryDto | null;
  error_message?: string | null;
}

export interface ReaderReadResponse {
  source_id: string;
  manga_id: string;
  manga_title: string;
  chapter_id: string;
  chapter_label: string;
  original_pages: string[];
  data_saver_pages: string[];
  proxied_original_pages: string[];
  proxied_saver_pages: string[];
  is_text_content: boolean;
  text_content?: string | null;
  previous_chapter_id?: string | null;
  next_chapter_id?: string | null;
  chapters: ReaderChapterDto[];
  comments: ReaderCommentDto[];
  error_message?: string | null;
}

export interface ChatbotProductCard {
  id: number;
  title: string;
  image_url: string;
  price: number;
  original_price: number | null;
  detail_url: string;
  category: string;
  is_available: boolean;
  rating: number;
}

export interface ChatbotReply {
  text: string;
  suggested_questions: string[];
  product_cards: ChatbotProductCard[];
}

export interface AdminDashboardResponse {
  stats: {
    total_revenue: number;
    total_orders: number;
    total_products: number;
    total_customers: number;
  };
  revenue_series: { month: string; revenue: number }[];
  category_share: { name: string; count: number; percentage: number; color: string }[];
  top_products: { id: number; name: string; sold: number; revenue: number }[];
  recent_orders: {
    order_code: string;
    customer_name: string;
    grand_total: number;
    status: string;
    payment_method: string;
    created_at: string;
  }[];
  product_table: {
    id: number;
    name: string;
    category: string;
    price: number;
    stock: number;
    status: string;
  }[];
}
