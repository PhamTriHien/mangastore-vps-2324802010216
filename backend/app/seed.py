from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Chapter, Manga

_SEED_MANGAS: tuple[dict[str, object], ...] = (
    {
        "title": "One Piece",
        "author": "Eiichiro Oda",
        "genre": "Shounen",
        "status": "Đang tiến hành",
        "cover_url": "/covers/one-piece.jpg",
        "rating": 4.9,
        "description": (
            "Monkey D. Luffy khởi đầu hành trình từ biển East Blue với chiếc mũ rơm "
            "được Shanks Tóc Đỏ trao gửi, quyết tâm tìm kiếm kho báu huyền thoại One Piece "
            "và trở thành Vua Hải Tặc cùng băng Mũ Rơm."
        ),
        "chapters": (
            (
                1.0,
                "Chương 1: Bình minh của chuyến phiêu lưu",
                "Tại ngôi làng Foosha yên bình bên bờ biển East Blue, cậu bé Monkey D. Luffy "
                "ngày nào cũng đứng trên cầu cảng dõi theo con tàu Red Force của băng hải tặc "
                "Tóc Đỏ. Dù bị Shanks trêu chọc vì không biết bơi, Luffy vẫn nuôi giấc mơ "
                "ra khơi khám phá đại dương bao la.\n\n"
                "Trong một lần sơ ý, cậu đã ăn nhầm Trái Ác Quỷ Gomu Gomu mà băng Shanks vừa "
                "thu giữ được, khiến toàn thân hóa thành cao su. Khi bọn sơn tặc Higuma gây "
                "hấn và ném Luffy xuống biển, Shanks đã đánh đổi cánh tay trái của mình để "
                "cứu cậu thoát khỏi hàm quái vật biển.\n\n"
                "Ngày đoàn tàu rời bến, Shanks đặt chiếc mũ rơm quý giá lên đầu Luffy và hẹn "
                "ngày gặp lại trên đỉnh cao của biển cả. Mười năm sau, Luffy một mình chèo "
                "chiếc thuyền nhỏ ra khơi, chính thức mở ra kỷ nguyên của băng hải tặc Mũ Rơm.",
            ),
            (
                2.0,
                "Chương 2: Người đàn ông đội mũ rơm",
                "Sau khi thoát khỏi xoáy nước khổng lồ bằng cách trốn trong một thùng rượu, "
                "Luffy dạt lên con tàu của nữ hải tặc Alvida. Tại đây, cậu tình cờ gặp Koby, "
                "một cậu bé nhút nhát bị ép làm lao công trên tàu suốt hai năm trời nhưng luôn "
                "ấp ủ ước mơ gia nhập Hải quân.\n\n"
                "Trước sự hung hăng của Alvida và cây chùy sắt khổng lồ, Luffy không hề nao "
                "núng. Cậu tung cú đấm Gomu Gomu no Pistol đánh bay mụ thuyền trưởng ra tận "
                "chân trời, giải thoát cho Koby khỏi nỗi sợ hãi bấy lâu.\n\n"
                "Được Luffy khích lệ, Koby lấy lại dũng khí để theo đuổi con đường công lý. "
                "Cả hai cùng chèo thuyền hướng về thị trấn Shells, nơi đang giam giữ một "
                "thợ săn hải tặc lừng danh tên Roronoa Zoro.",
            ),
            (
                3.0,
                "Chương 3: Thợ săn hải tặc Zoro",
                "Thị trấn Shells nằm dưới sự cai trị hà khắc của Đại tá Hải quân Morgan Tay Rìu "
                "và gã con trai hống hách Helmeppo. Giữa sân tập của căn cứ, kiếm sĩ Roronoa Zoro "
                "bị trói vào cọc gỗ chịu đói khát suốt nhiều ngày để bảo vệ một cô bé vô tội.\n\n"
                "Nhận thấy bản lĩnh và tinh thần chính trực của Zoro, Luffy đề nghị anh gia nhập "
                "thủy thủ đoàn của mình. Ban đầu Zoro từ chối, nhưng khi Helmeppo lộ rõ âm mưu "
                "hành quyết lật lọng, Luffy đã xông vào căn cứ lấy lại ba thanh kiếm cho Zoro.\n\n"
                "Sát cánh bên nhau, Luffy và Zoro đánh bại Morgan cùng binh đoàn tay sai. "
                "Với lời thề trở thành kiếm sĩ mạnh nhất thế giới của Zoro, băng Mũ Rơm chính "
                "thức có vị thuyền viên đầu tiên trước khi hướng tới Grand Line.",
            ),
        ),
    },
    {
        "title": "Naruto",
        "author": "Masashi Kishimoto",
        "genre": "Shounen",
        "status": "Hoàn thành",
        "cover_url": "/covers/naruto.jpg",
        "rating": 4.8,
        "description": (
            "Uzumaki Naruto, cậu bé mang trong mình phong ấn Cửu Vĩ Hồ Ly bị dân làng Lá "
            "xa lánh, không ngừng nỗ lực rèn luyện nhẫn thuật để được công nhận và thực hiện "
            "ước mơ trở thành Hokage vĩ đại."
        ),
        "chapters": (
            (
                1.0,
                "Chương 1: Uzumaki Naruto",
                "Mười hai năm trước, Cửu Vĩ Hồ Ly tấn công Làng Lá và chỉ chịu khuất phục khi "
                "Hokage Đệ Tứ hy sinh tính mạng phong ấn nó vào cơ thể một đứa trẻ sơ sinh. "
                "Đứa trẻ đó là Uzumaki Naruto, lớn lên trong sự cô độc và ánh nhìn dè chừng "
                "của hầu hết người dân trong làng.\n\n"
                "Để thu hút sự chú ý, Naruto thường xuyên bày trò nghịch phá và liên tục trượt "
                "kỳ thi tốt nghiệp Học viện Ninja vì kỹ thuật phân thân yếu kém. Bị tên ninja "
                "phản bội Mizuki lừa đánh cắp Cuộn Thư Phong Ấn, cậu rơi vào vòng nguy hiểm "
                "ngay giữa khu rừng tối.\n\n"
                "Khoảnh khắc thầy Iruka lấy thân mình che chắn phi tiêu cho học trò đã đánh "
                "thức ý chí trong Naruto. Bằng thuật Đa Trọng Ảnh Phân Thân vừa lĩnh hội, "
                "cậu hạ gục Mizuki và nhận được chiếc băng trán Làng Lá đầu tiên trong đời.",
            ),
            (
                2.0,
                "Chương 2: Đội 7 thành lập",
                "Sau khi chính thức trở thành Hạ Nhẫn, Naruto được phân vào Đội 7 cùng thiên "
                "tài lạnh lùng Uchiha Sasuke và nữ ninja thông minh Haruno Sakura. Người dẫn "
                "dắt họ là Thượng Nhẫn Hatake Kakashi, nổi tiếng với biệt danh Ninja Sao Chép.\n\n"
                "Buổi gặp mặt đầu tiên trên sân thượng hé lộ những mục tiêu hoàn toàn trái ngược "
                "của ba học trò trẻ tuổi. Tuy nhiên, thầy Kakashi tuyên bố họ vẫn phải vượt qua "
                "bài kiểm tra cướp chuông sinh tử trước khi được công nhận là ninja thực thụ.\n\n"
                "Với quy định tàn khốc chỉ có hai chiếc chuông cho ba người, mâu thuẫn nội bộ "
                "nhanh chóng nảy sinh ngay khi tiếng hiệu lệnh vừa vang lên trên bãi tập.",
            ),
            (
                3.0,
                "Chương 3: Bài kiểm tra chuông bạc",
                "Không thể tự mình chạm tới chuông trước trình độ vượt trội của thầy Kakashi, "
                "Naruto bị trói vào cột gỗ giữa trưa nắng trong khi Sasuke và Sakura cũng kiệt "
                "sức vì hành động đơn lẻ. Thầy Kakashi nghiêm khắc nhắc nhở về tầm quan trọng "
                "của tinh thần đồng đội.\n\n"
                "Dù bị cấm chia sẻ thức ăn cho Naruto, Sasuke là người đầu tiên đưa hộp cơm "
                "lên trước, nhận ra cậu bạn đồng hành không thể chiến đấu khi đói lả. Sakura "
                "cũng lập tức làm theo dù lo sợ bị đánh rớt ngay tại chỗ.\n\n"
                "Khoảnh khắc cả ba đặt đồng đội lên trên luật lệ cứng nhắc, thầy Kakashi mỉm "
                "cười tuyên bố toàn đội đã vượt qua. Câu nói bất hủ về những kẻ bỏ rơi bạn bè "
                "trở thành kim chỉ nam theo suốt hành trình của Đội 7.",
            ),
        ),
    },
    {
        "title": "Dragon Ball Super",
        "author": "Akira Toriyama",
        "genre": "Shounen",
        "status": "Đang tiến hành",
        "cover_url": "/covers/dragon-ball.jpg",
        "rating": 4.8,
        "description": (
            "Sau chiến thắng trước Ma Bư, hòa bình Trái Đất một lần nữa đối mặt thử thách "
            "khi Thần Hủy Diệt Beerus thức tỉnh và mở ra các giải đấu quy tụ những chiến binh "
            "mạnh nhất đa vũ trụ."
        ),
        "chapters": (
            (
                1.0,
                "Chương 1: Giấc mộng Thần Hủy Diệt",
                "Sau thời gian dài hòa bình kể từ trận chiến với Ma Bư, Son Goku làm công việc "
                "canh tác ruộng đồng theo lời vợ nhưng vẫn tranh thủ từng phút giây để rèn luyện "
                "võ thuật. Trong khi đó, tại một hành tinh xa xôi ở Vũ trụ thứ 7, Thần Hủy Diệt "
                "Beerus bất ngờ thức giấc sau giấc ngủ kéo dài nhiều thập kỷ.\n\n"
                "Điều khiến vị thần quyền năng bận tâm là giấc mơ tiên tri về một chiến binh "
                "mang danh hiệu Siêu Saiyan Thần có thể sánh ngang sức mạnh với ông. Cùng thiên "
                "sứ Whis, Beerus bắt đầu rà soát tung tích những người Saiyan còn sống sót.\n\n"
                "Khi nhận được thông báo từ hành tinh của Thần Vũ Trụ Kaio, Goku không giấu nổi "
                "sự phấn khích trước viễn cảnh được giao đấu với đối thủ mạnh mẽ chưa từng thấy.",
            ),
            (
                2.0,
                "Chương 2: Cuộc chạm trán trên hành tinh Kaio",
                "Bất chấp lời cảnh báo khẩn thiết từ Kaio, Goku vẫn giữ nguyên sự háo hức khi "
                "Beerus và Whis đặt chân tới hành tinh nhỏ bé nơi cậu đang tập luyện. Ông yêu cầu "
                "được thử sức để kiểm chứng trình độ hiện tại của mình.\n\n"
                "Dù Goku lần lượt biến hình lên các cấp độ Siêu Saiyan 1, 2 rồi 3 với nguồn khí "
                "bùng nổ dữ dội, mọi đòn tấn công của cậu đều bị Beerus hóa giải nhẹ nhàng chỉ "
                "bằng những cú búng tay đơn giản. Chỉ với hai đòn đánh gọn gàng, Goku gục ngã.\n\n"
                "Thất vọng vì chưa tìm thấy Siêu Saiyan Thần trong lời tiên tri, Beerus quyết "
                "định tiến thẳng về Trái Đất, nơi Vegeta và những người Saiyan khác đang tụ họp.",
            ),
            (
                3.0,
                "Chương 3: Nghi thức Siêu Saiyan Thần",
                "Tại bữa tiệc sinh nhật của Bulma trên du thuyền sang trọng, Vegeta dốc hết tâm "
                "sức giữ hòa khí nhằm tránh cơn thịnh nộ của Beerus. Thế nhưng chỉ một sự cố nhỏ "
                "liên quan đến món bánh pudding đã đẩy Trái Đất vào bờ vực hủy diệt.\n\n"
                "Không ai trong nhóm chiến binh đủ sức ngăn cản Beerus cho tới khi Goku kịp quay "
                "về và triệu hồi Rồng Thần Shenron để hỏi bí mật về Siêu Saiyan Thần. Rồng Thần "
                "tiết lộ nghi thức truyền khí từ năm người Saiyan có trái tim thuần khiết.\n\n"
                "Nhờ sự hợp lực của Vegeta, Gohan, Goten, Trunks và cả sinh linh trong bụng "
                "Videl, luồng hào quang rực đỏ bao trùm lấy Goku, mở ra cảnh giới sức mạnh thần "
                "thánh hoàn toàn mới.",
            ),
        ),
    },
    {
        "title": "Demon Slayer: Kimetsu no Yaiba",
        "author": "Koyoharu Gotouge",
        "genre": "Shounen",
        "status": "Hoàn thành",
        "cover_url": "/covers/demon-slayer.jpg",
        "rating": 4.9,
        "description": (
            "Bi kịch ập đến khi gia đình bị quỷ sát hại và em gái Nezuko hóa quỷ, đẩy "
            "Kamado Tanjiro bước vào con đường kiếm sĩ Sát Quỷ Đoàn để tìm phương thuốc "
            "đưa em gái trở lại làm người."
        ),
        "chapters": (
            (
                1.0,
                "Chương 1: Tàn khốc giữa đêm tuyết",
                "Sống trên sườn núi phủ tuyết trắng thời kỳ Taisho, cậu thiếu niên hiền lành "
                "Kamado Tanjiro gánh vác gia đình bằng nghề đốt và bán than củi dưới thị trấn. "
                "Một buổi tối trời trở lạnh, cậu đành ở lại nhà ông Saburo qua đêm vì lời cảnh "
                "báo về loài quỷ ăn thịt người rình rập trong rừng sâu.\n\n"
                "Sáng hôm sau khi vừa bước chân lên triền dốc gần nhà, mùi máu tanh nồng nặc "
                "khiến Tanjiro linh cảm điều chẳng lành. Toàn bộ mẹ và các em nhỏ đều đã bị sát "
                "hại thảm khốc, duy chỉ còn cô em gái Nezuko vẫn còn chút hơi ấm yếu ớt.\n\n"
                "Trên đường cõng em đi tìm thầy thuốc giữa bão tuyết, Nezuko bất ngờ tỉnh dậy "
                "trong hình hài quỷ dữ. Đúng lúc kiếm sĩ Tomioka Giyuu xuất hiện định ra tay "
                "tiêu diệt, bản năng bảo vệ anh trai của Nezuko đã khiến anh kinh ngạc dừng kiếm.",
            ),
            (
                2.0,
                "Chương 2: Lời chỉ dẫn tới núi Sagiri",
                "Nhận thấy sự khác biệt kỳ lạ nơi hai anh em nhà Kamado, Thủy Trụ Tomioka Giyuu "
                "trao cho Tanjiro cơ hội chứng minh Nezuko sẽ không bao giờ làm hại con người. "
                "Anh chỉ dẫn cậu tìm đến ông Urokodaki Sakonji sống dưới chân núi Sagiri.\n\n"
                "Trên hành trình băng qua rừng đêm, Tanjiro phải tự tay chế tạo chiếc giỏ tre "
                "che nắng cho Nezuko ngủ say vào ban ngày và đối đầu tên quỷ đầu tiên tại một "
                "ngôi đền hoang vắng. Cậu học được rằng ánh sáng mặt trời và nhật luân đao mới "
                "có thể tiêu diệt hoàn toàn loài quỷ.\n\n"
                "Khi tới chân núi Sagiri trong tình trạng kiệt sức, Tanjiro gặp cựu Thủy Trụ "
                "Urokodaki với chiếc mặt nạ tengu đỏ thẫm và thử thách đầu tiên đầy khắc nghiệt.",
            ),
            (
                3.0,
                "Chương 3: Tảng đá lớn và hơi thở của nước",
                "Suốt hơn một năm ròng rã trên đỉnh núi mù sương, Tanjiro phải vượt qua vô số "
                "bẫy chông ẩn hiện trong rừng và luyện tập kỹ thuật Hơi Thở Tập Trung Toàn Phần "
                "để tăng cường thể lực vượt giới hạn người thường.\n\n"
                "Thử thách cuối cùng trước kỳ Tuyển Chọn Cuối Cùng là dùng thanh kiếm thật chém "
                "đôi một tảng đá khổng lồ. Nỗ lực suốt nhiều tháng vẫn bất thành khiến Tanjiro "
                "rơi vào bế tắc cho đến khi hai thiếu niên bí ẩn Sabito và Makomo xuất hiện.\n\n"
                "Dưới sự chỉ dạy và rèn giũa không ngừng của Sabito, thanh kiếm của Tanjiro cuối "
                "cùng cũng lướt qua và xẻ đôi tảng đá cứng như sắt, khẳng định cậu đã sẵn sàng "
                "bước vào Sát Quỷ Đoàn.",
            ),
        ),
    },
    {
        "title": "Jujutsu Kaisen",
        "author": "Gege Akutami",
        "genre": "Shounen",
        "status": "Hoàn thành",
        "cover_url": "/covers/jujutsu-kaisen.jpg",
        "rating": 4.7,
        "description": (
            "Itadori Yuji vô tình nuốt phải ngón tay của Vua Nguyền Rủa Ryomen Sukuna để "
            "cứu bạn bè, từ đó gia nhập Cao chuyên Chú thuật Tokyo và bước vào thế giới chiến "
            "đấu chống lại các oán linh."
        ),
        "chapters": (
            (
                1.0,
                "Chương 1: Ryomen Sukuna",
                "Itadori Yuji sở hữu thể chất phi thường nhưng lại chọn gia nhập câu lạc bộ "
                "nghiên cứu tâm linh để có thời gian chăm sóc ông nội đang nằm viện. Trước lúc "
                "lâm chung, ông dặn Yuji hãy sống một cuộc đời biết giúp đỡ mọi người xung quanh.\n\n"
                "Cùng tối hôm đó, chú thuật sư Fushiguro Megumi tìm đến trường cấp ba Sugisawa "
                "để thu hồi chú vật đặc cấp bị thất lạc: một ngón tay khô của Ryomen Sukuna. "
                "Tuy nhiên, hai người bạn trong câu lạc bộ của Yuji đã vô tình gỡ bỏ bùa phong ấn.\n\n"
                "Trong khoảnh khắc bị nguyền hồn khổng lồ áp đảo giữa sân trường đổ nát, Yuji "
                "quyết định nuốt chửng ngón tay Sukuna để mượn chú lực giải cứu Megumi và bạn "
                "bè, bất ngờ kiểm soát được ý thức của chính Vua Nguyền Rủa.",
            ),
            (
                2.0,
                "Chương 2: Án tử hình treo lơ lửng",
                "Vì mang trong mình vật chứa của Sukuna, Yuji lập tức bị hội đồng chú thuật "
                "tuyên án tử hình ngay lập tức. Khi tỉnh dậy trong căn phòng đầy bùa chú, cậu "
                "đối mặt với Gojo Satoru, chú thuật sư mạnh nhất thời hiện đại.\n\n"
                "Gojo kiểm tra khả năng kiềm chế Sukuna của Yuji bằng một màn trao đổi ngắn gọn "
                "nhưng đầy uy áp. Ấn tượng trước sự ổn định hiếm có của cậu học sinh trung học, "
                "thầy Gojo đề xuất phương án hoãn thi hành án.\n\n"
                "Theo thỏa thuận mới, Yuji sẽ nhập học Cao chuyên Chú thuật Tokyo để thu thập và "
                "hấp thụ toàn bộ hai mươi ngón tay của Sukuna trước khi chấp nhận cái chết nhằm "
                "xóa sổ Vua Nguyền Rủa vĩnh viễn.",
            ),
            (
                3.0,
                "Chương 3: Cô gái từ vùng quê Morioka",
                "Ngày đầu tiên bước chân vào ngôi trường cổ kính ẩn mình trên núi, Yuji cùng "
                "Megumi và thầy Gojo ra ga Harajuku đón thành viên thứ ba của lớp năm nhất: "
                "Kugisaki Nobara, nữ chú thuật sư thẳng tính mới chuyển từ quê lên thủ đô.\n\n"
                "Để kiểm tra bản lĩnh thực chiến của hai tân binh, Gojo giao nhiệm vụ thanh tẩy "
                "một tòa nhà bỏ hoang tại khu Roppongi đang bị oán linh chiếm giữ. Yuji và "
                "Nobara phối hợp trong bầu không khí vừa căng thẳng vừa đầy những màn tranh cãi.\n\n"
                "Khi chú linh bắt giữ một em nhỏ làm con tin, Yuji phá tường xông vào tạo sơ hở "
                "để Nobara tung chú thuật Cộng Hưởng dứt điểm mục tiêu, đánh dấu chiến công "
                "đầu tiên của bộ ba năm nhất.",
            ),
        ),
    },
    {
        "title": "My Hero Academia",
        "author": "Kohei Horikoshi",
        "genre": "Shounen",
        "status": "Hoàn thành",
        "cover_url": "/covers/my-hero-academia.jpg",
        "rating": 4.6,
        "description": (
            "Sinh ra không sở hữu năng lực đặc biệt giữa xã hội anh hùng, cậu bé Midoriya "
            "Izuku vẫn không từ bỏ giấc mơ và được biểu tượng hòa bình All Might truyền lại "
            "sức mạnh One For All."
        ),
        "chapters": (
            (
                1.0,
                "Chương 1: Giấc mơ của kẻ vô năng",
                "Trong thế giới nơi tám mươi phần trăm dân số sở hữu siêu năng lực gọi là Kosei, "
                "Midoriya Izuku từ nhỏ đã được chẩn đoán hoàn toàn vô năng. Dù vậy, cậu vẫn ghi "
                "chép tỉ mỉ từng chiến thuật của các anh hùng vào hàng chục cuốn sổ tay.\n\n"
                "Bị bạn cũ Bakugo Katsuki chế giễu và ném quyển sổ xuống hồ nước, Izuku lầm lũi "
                "trở về qua đường hầm tối và bất ngờ bị một tên tội phạm bùn nhầy tấn công. "
                "Giữa lúc tuyệt vọng nhất, All Might bất ngờ xuất hiện đánh tan kẻ địch chỉ "
                "bằng một cú đấm tạo gió bão.\n\n"
                "Chứng kiến Izuku không màng nguy hiểm lao vào giải cứu Bakugo khỏi tên tội phạm "
                "bùn ngay sau đó, All Might nhận ra phẩm chất anh hùng đích thực nơi cậu bé và "
                "khẳng định cậu hoàn toàn có thể trở thành anh hùng.",
            ),
            (
                2.0,
                "Chương 2: Bãi biển Dagoba và ngọn đuốc kế thừa",
                "All Might tiết lộ bí mật về Kosei One For All, nguồn sức mạnh được tích tụ và "
                "truyền thừa qua nhiều thế hệ nhằm đối đầu thế lực hắc ám. Để cơ thể Izuku không "
                "bị phá hủy khi tiếp nhận năng lực này, cậu phải trải qua mười tháng rèn luyện.\n\n"
                "Dưới lịch trình khắt khe do chính All Might thiết kế, Izuku dọn sạch hàng tấn "
                "rác thải kim loại chất đống suốt nhiều năm trên bãi biển công cộng Dagoba. "
                "Cậu tập luyện đến kiệt sức từ sáng sớm đến tận đêm khuya.\n\n"
                "Đúng rạng sáng ngày diễn ra kỳ thi tuyển vào Học viện U.A, bãi biển hoàn toàn "
                "trả lại vẻ trong xanh. All Might mỉm cười trao sợi tóc chứa DNA của mình cho "
                "Izuku, chính thức chuyển giao ngọn đuốc kế thừa.",
            ),
            (
                3.0,
                "Chương 3: Kỳ thi đầu vào Học viện U.A",
                "Bước vào khu mô phỏng đô thị rộng lớn trong kỳ thi thực hành của Học viện U.A, "
                "Izuku vẫn chưa hề có cơ hội thử nghiệm năng lực mới trước khi còi khai cuộc "
                "vang lên. Hàng loạt robot chiến đấu lao ra từ mọi ngả đường.\n\n"
                "Khi thời gian đếm ngược dần cạn mà bảng điểm của Izuku vẫn dừng ở con số không, "
                "cỗ máy khổng lồ không điểm bất ngờ trồi lên làm rung chuyển cả khu phố giả lập. "
                "Mọi thí sinh đều bỏ chạy tán loạn, riêng cô bạn Uraraka Ochako bị kẹt chân dưới "
                "đống gạch vỡ.\n\n"
                "Không chút do dự, Izuku dồn toàn bộ One For All vào cánh tay phải, tung cú nhảy "
                "vút lên tầng cao và đấm tan xác cỗ máy khổng lồ để cứu người, mở ra cánh cửa "
                "bước vào lớp anh hùng danh giá.",
            ),
        ),
    },
    {
        "title": "Attack on Titan",
        "author": "Hajime Isayama",
        "genre": "Seinen",
        "status": "Hoàn thành",
        "cover_url": "/covers/attack-on-titan.jpg",
        "rating": 4.9,
        "description": (
            "Nhân loại co cụm sau ba bức tường thành khổng lồ suốt một thế kỷ bỗng rơi vào "
            "thảm họa khi Titan Đại Hình phá vỡ cổng Shiganshina, châm ngòi cho cuộc chiến "
            "sinh tồn đầy bí ẩn của Eren Yeager."
        ),
        "chapters": (
            (
                1.0,
                "Chương 1: Gửi em của hai nghìn năm sau",
                "Suốt hơn một trăm năm yên bình đằng sau ba lớp tường thành Maria, Rose và Sina "
                "cao năm mươi mét, phần lớn cư dân quận Shiganshina đã quen sống trong vòng an "
                "toàn khép kín. Chỉ riêng cậu bé Eren Yeager luôn khát khao được gia nhập Trinh "
                "Sát Đoàn để bước ra thế giới rộng lớn bên ngoài.\n\n"
                "Trong lúc Eren cùng Mikasa Ackerman quay về nhà sau chuyến nhặt củi, một tia "
                "sét vàng chói lòa giáng xuống ngay sát bức tường ngoài cùng. Phần đầu khổng lồ "
                "của Titan Đại Hình trồi lên cao hơn cả đỉnh tường thành khiến cả thị trấn chết "
                "lặng trong kinh hoàng.\n\n"
                "Một cú đá kinh thiên động địa phá toang cánh cổng Shiganshina, mở đường cho "
                "hàng đàn Titan tràn vào tàn sát. Bi kịch cướp đi người mẹ thân yêu ngay trước "
                "mắt khiến Eren thề sẽ quét sạch toàn bộ loài Titan khỏi mặt đất.",
            ),
            (
                2.0,
                "Chương 2: Ngày thành Maria thất thủ",
                "Cánh cổng trong của thành Maria cũng bị Titan Thiết Giáp húc sập ngay sau đó, "
                "buộc phần lớn dân tị nạn phải tháo chạy bằng đường thủy vào vùng đất chật hẹp "
                "phía sau thành Rose. Mất đi một phần ba lãnh thổ đồng nghĩa với nạn đói cận kề.\n\n"
                "Sống lay lắt trong khu tị nạn cùng Mikasa và cậu bạn thông minh Armin Arlert, "
                "Eren chứng kiến cảnh chính quyền đẩy hàng trăm nghìn người đi tái chiếm thành "
                "Maria như một chiến dịch cắt giảm miệng ăn tàn nhẫn.\n\n"
                "Hai năm sau thảm kịch, khi đủ tuổi nhập ngũ, cả ba người bạn thân cùng ghi danh "
                "vào Khóa Huấn Luyện 104, chấp nhận rèn luyện khắc nghiệt với bộ động cơ cơ động "
                "ba chiều để giành lấy cơ hội phản công.",
            ),
            (
                3.0,
                "Chương 3: Đêm tối giữa khóa huấn luyện",
                "Tại doanh trại huấn luyện khắc nghiệt dưới quyền chỉ huy nghiêm khắc của giáo "
                "quan Keith Shadis, các tân binh đến từ khắp mọi miền phải trải qua bài kiểm "
                "tra giữ thăng bằng trên dây cáp. Trong khi Mikasa làm chủ thiết bị ngay lập tức, "
                "Eren liên tục chúi đầu xuống đất.\n\n"
                "Không chấp nhận thất bại, Eren thức trắng đêm tập luyện và tìm kiếm lời khuyên "
                "từ Reiner Braun cùng Bertolt Hoover. Sáng hôm sau trước sự chứng kiến của cả "
                "tiểu đội, cậu vẫn bám trụ thành công chỉ trong vài giây ngắn ngủi trước khi "
                "phát hiện khóa thắt lưng bị hỏng từ đầu.\n\n"
                "Khi chuyển sang bộ trang bị lành lặn, Eren giữ thăng bằng hoàn hảo không chút "
                "rung lắc, khẳng định ý chí thép không gì lay chuyển nổi trên con đường tiến về "
                "Trinh Sát Đoàn.",
            ),
        ),
    },
    {
        "title": "Spy x Family",
        "author": "Tatsuya Endo",
        "genre": "Comedy",
        "status": "Đang tiến hành",
        "cover_url": "/covers/spy-family.jpg",
        "rating": 4.8,
        "description": (
            "Điệp viên hàng đầu Hoàng Hôn buộc phải lập một gia đình giả cho nhiệm vụ hòa "
            "bình, chẳng ngờ cô con gái nuôi lại biết đọc suy nghĩ còn người vợ hờ chính là "
            "nữ sát thủ khét tiếng."
        ),
        "chapters": (
            (
                1.0,
                "Chương 1: Chiến dịch Strix khởi động",
                "Nhằm ngăn chặn nguy cơ chiến tranh nổ ra giữa hai quốc gia Westalis và Ostania, "
                "điệp viên huyền thoại mang mật danh Hoàng Hôn nhận nhiệm vụ tối mật mang tên "
                "Chiến dịch Strix. Để tiếp cận nhân vật chính trị khép kín Donovan Desmond, anh "
                "phải dựng nên một gia đình giả trong vòng bảy ngày.\n\n"
                "Dưới thân phận bác sĩ tâm thần Loid Forger, anh tìm đến một cô nhi viện tồi tàn "
                "và nhận nuôi cô bé Anya. Cô bé tỏ ra đặc biệt thông minh khi giải nhanh tờ câu "
                "đố chữ mà không hay rằng Anya thực chất là vật thí nghiệm sở hữu năng lực đọc "
                "thấu suy nghĩ của người khác.\n\n"
                "Dù ban đầu Loid chỉ coi Anya là công cụ phục vụ điệp vụ, khoảnh khắc anh liều "
                "mình giải cứu cô bé khỏi nhóm bắt cóc đã khiến sợi dây gắn kết đầu tiên âm thầm "
                "hình thành trong ngôi nhà mới.",
            ),
            (
                2.0,
                "Chương 2: Tìm kiếm người mẹ hoàn hảo",
                "Vượt qua bài kiểm tra viết vào học viện danh giá Eden, Loid bất ngờ phát hiện "
                "buổi phỏng vấn gia đình bắt buộc phải có đầy đủ cả cha lẫn mẹ. Trong lúc gấp "
                "rút tìm người đóng vai vợ hờ, anh tình cờ gặp Yor Briar tại một tiệm may.\n\n"
                "Thực chất Yor là sát thủ khét tiếng Công Chúa Gai đang cần một người chồng giả "
                "để tránh sự nghi ngờ của đồng nghiệp và mật vụ nhà nước. Hai người nhanh chóng "
                "tìm thấy lợi ích chung, trong khi Anya hào hứng chứng kiến thân phận thật của "
                "cả cha lẫn mẹ qua năng lực ngoại cảm.\n\n"
                "Đêm cuối tuần trong bữa tiệc của đồng nghiệp Yor, Loid trễ hẹn vì một cuộc truy "
                "đuổi căng thẳng. Trước sự chế nhạo của khách mời, anh xuất hiện kịp thời bảo vệ "
                "danh dự cho Yor và đề nghị cả hai kết hôn ngay lập tức.",
            ),
            (
                3.0,
                "Chương 3: Buổi diễn tập gia đình Forger",
                "Sau khi dọn về sống chung dưới một mái nhà, Loid nhận ra điểm yếu lớn nhất của "
                "gia đình Forger là sự thiếu ăn ý trước cuộc phỏng vấn khắt khe tại Học viện Eden. "
                "Anh lập tức lên lịch trình tập dượt cách ứng xử chuẩn mực tầng lớp thượng lưu.\n\n"
                "Từ thói quen thưởng thức nhạc kịch, phòng tranh nghệ thuật cho đến cách thưởng "
                "trà lịch lãm, mọi nỗ lực của Loid đều dẫn tới hàng loạt tình huống dở khóc dở "
                "cười khi Yor ngây ngô còn Anya liên tục bị phân tâm bởi bánh ngọt.\n\n"
                "Chỉ đến khi cả ba cùng nhau ngăn chặn một tên cướp túi xách giữa phố đông, Loid "
                "mới nhận ra những đặc điểm kỳ lạ nhưng đầy chân thành của từng thành viên mới "
                "chính là điểm tựa vững chắc nhất cho gia đình kỳ quặc này.",
            ),
        ),
    },
    {
        "title": "Chainsaw Man",
        "author": "Tatsuki Fujimoto",
        "genre": "Action",
        "status": "Đang tiến hành",
        "cover_url": "/covers/chainsaw-man.jpg",
        "rating": 4.8,
        "description": (
            "Thiếu niên nghèo khổ Denji hợp nhất cùng chú quỷ cưa máy Pochita sau khi bị "
            "phản bội sát hại, trở thành Người Cưa và gia nhập Cục An ninh Công cộng săn lùng "
            "ác quỷ."
        ),
        "chapters": (
            (
                1.0,
                "Chương 1: Chú chó và chiếc cưa máy",
                "Sống vật lộn giữa đống nợ nần khổng lồ do người cha quá cố để lại cho băng đảng "
                "yakuza, cậu thiếu niên Denji phải bán đi nhiều bộ phận cơ thể và nhận làm thợ "
                "săn quỷ tự do. Người bạn duy nhất bên cạnh cậu là Pochita, chú quỷ nhỏ mang lưỡi "
                "cưa máy trên đầu.\n\n"
                "Một đêm mưa gió tại nhà kho bỏ hoang, băng đảng yakuza phản bội đã ký khế ước "
                "với Quỷ Thây Ma và chém xác Denji thành từng mảnh vứt vào thùng rác. Trong cơn "
                "hấp hối, máu của cậu thấm vào cơ thể Pochita đang yếu dần.\n\n"
                "Để cứu sống cậu chủ, Pochita quyết định hiến dâng trái tim của mình hợp nhất "
                "cùng Denji với giao kèo hãy cho cậu thấy những giấc mơ bình dị. Khi sợi dây "
                "trước ngực được giật mạnh, Người Cưa vùng dậy quét sạch cả bầy thây ma.",
            ),
            (
                2.0,
                "Chương 2: Đặt chân tới Tokyo",
                "Sáng hôm sau giữa đống xác thây ma ngổn ngang, Makima, nữ chỉ huy cấp cao của "
                "Cục An ninh Công cộng, bước tới bên Denji đang kiệt sức. Trước sự lựa chọn tàn "
                "nhẫn giữa việc bị thủ tiêu như một con quỷ hoặc trở thành cấp dưới của cô, "
                "Denji đồng ý theo Makima về Tokyo.\n\n"
                "Trên đường đi, lần đầu tiên trong đời cậu được thưởng thức một bữa ăn nóng hổi "
                "đầy đủ dinh dưỡng thay vì ổ bánh mì mốc meo không nhân. Ánh nhìn dịu dàng nhưng "
                "đầy bí ẩn của Makima khiến Denji nhanh chóng đặt trọn niềm tin vào công việc mới.\n\n"
                "Tại trụ sở Tokyo, Makima bàn giao Denji cho Hayakawa Aki, một thợ săn quỷ nghiêm "
                "túc mang mối thù sâu nặng với Quỷ Súng, hứa hẹn cuộc sống đồng đội đầy va chạm.",
            ),
            (
                3.0,
                "Chương 3: Sự xuất hiện của Power",
                "Mâu thuẫn giữa Denji phóng khoáng và Aki nguyên tắc bùng nổ ngay từ những ngày "
                "đầu chung đội, nhưng cả hai nhanh chóng phải hợp tác khi Makima phân công thêm "
                "một cộng sự mới cho nhóm.\n\n"
                "Người đồng hành đó là Power, một Ác Quỷ Huyết Mang hình hài cô gái có đôi sừng "
                "đỏ trên đầu và tính cách hoang dã, bất cần đời. Ngay trong nhiệm vụ đầu tiên, "
                "Power không ngần ngại chém gục mục tiêu bất chấp lệnh kiềm chế của Aki.\n\n"
                "Tuy thường xuyên khoe khoang và cãi vã không ngừng với Denji, Power sớm hé lộ "
                "câu chuyện về chú mèo cưng Meowy bị Quỷ Dơi bắt giữ, kéo Denji vào một cái bẫy "
                "nguy hiểm ngoài vùng ngoại ô.",
            ),
        ),
    },
    {
        "title": "Tokyo Revengers",
        "author": "Ken Wakui",
        "genre": "Action",
        "status": "Hoàn thành",
        "cover_url": "/covers/tokyo-revengers.jpg",
        "rating": 4.5,
        "description": (
            "Hanagaki Takemichi bất ngờ có khả năng du hành ngược về mười hai năm trước, "
            "dùng ý chí bền bỉ thâm nhập băng Tokyo Manji nhằm thay đổi tương lai và cứu sống "
            "bạn gái cũ Hinata."
        ),
        "chapters": (
            (
                1.0,
                "Chương 1: Cú đẩy trên sân ga định mệnh",
                "Ở tuổi hai mươi sáu, Hanagaki Takemichi sống cuộc đời tẻ nhạt trong căn phòng "
                "trọ bừa bộn và làm nhân viên bán thời gian thường xuyên bị cấp dưới mắng mỏ. "
                "Tin tức buổi trưa bất ngờ đưa tin Tachibana Hinata, bạn gái duy nhất thời trung "
                "học của anh, đã thiệt mạng trong một vụ thanh trừng của băng Tokyo Manji.\n\n"
                "Trên đường đi làm ngày hôm sau, khi đang đứng chờ tàu tại sân ga đông đúc, một "
                "bàn tay bí ẩn bất ngờ đẩy mạnh Takemichi rơi thẳng xuống đường ray ngay trước "
                "mũi đoàn tàu đang lao tới.\n\n"
                "Tưởng chừng cái chết đã cận kề, Takemichi choàng mở mắt và kinh hoàng nhận ra "
                "mình vừa quay ngược thời gian trở lại đúng mười hai năm trước, thời điểm anh "
                "còn là cậu học sinh cấp hai tóc vàng ngổ ngáo.",
            ),
            (
                2.0,
                "Chương 2: Giao ước với Naoto",
                "Trong dòng thời gian năm 2005, Takemichi gặp lại những người bạn cũ năm xưa và "
                "tìm đến căn hộ của Hinata để xác nhận cô vẫn đang bình yên vô sự. Trên đường "
                "về nhà, anh tình cờ bắt gặp em trai cô là Tachibana Naoto đang bị nhóm côn đồ "
                "bắt nạt.\n\n"
                "Sau khi giải cứu cậu bé, Takemichi buột miệng tiết lộ sự kiện thảm khốc sẽ xảy "
                "ra đúng mười hai năm sau rồi bắt tay căn dặn Naoto bằng mọi giá phải bảo vệ chị "
                "gái. Ngay khoảnh khắc hai bàn tay chạm nhau, anh bị kéo trở về hiện tại.\n\n"
                "Tỉnh dậy trong bệnh viện năm 2017, Takemichi sững sờ khi thấy Naoto giờ đã là "
                "cảnh sát trưởng thành. Chính cú bắt tay ấy đã trở thành chìa khóa kích hoạt "
                "năng lực du hành thời gian để hai người cùng sửa chữa quá khứ.",
            ),
            (
                3.0,
                "Chương 3: Đấu trường ngầm và Mikey Vô Địch",
                "Quay trở lại quá khứ lần thứ hai với quyết tâm ngăn cản băng Tokyo Manji biến "
                "chất, Takemichi bị nhóm đàn anh Kiyomasa lôi vào một trận đấu tay đôi phi pháp "
                "để mua vui cho đám đông cá cược.\n\n"
                "Dù bị đánh bầm dập đến mức không thể đứng vững, Takemichi nhất quyết không chịu "
                "khuất phục vì hiểu rằng lùi bước hôm nay đồng nghĩa với cái chết của Hinata "
                "trong tương lai. Sự lì lợm ấy làm cả đám đông bất ngờ nín lặng.\n\n"
                "Đúng lúc Kiyomasa định rút gậy kết liễu, hai nhân vật quyền lực nhất băng Tokyo "
                "Manji là tổng trưởng Mikey và phó tổng trưởng Draken bước vào sân đấu, mở ra "
                "bước ngoặt định mệnh cho cuộc đời Takemichi.",
            ),
        ),
    },
    {
        "title": "Blue Lock",
        "author": "Muneyuki Kaneshiro",
        "genre": "Sports",
        "status": "Đang tiến hành",
        "cover_url": "/covers/blue-lock.jpg",
        "rating": 4.8,
        "description": (
            "Nhằm tạo ra tiền đạo ích kỷ bậc nhất giúp bóng đá Nhật Bản vô địch World Cup, "
            "dự án Blue Lock nhốt ba trăm chân sút trẻ vào cuộc đào thải tàn khốc không có "
            "chỗ cho thất bại."
        ),
        "chapters": (
            (
                1.0,
                "Chương 1: Khát vọng của tiền đạo số một",
                "Giây phút quyết định ở trận chung kết vòng loại khu vực Saitama, tiền đạo trẻ "
                "Isagi Yoichi đứng trước khung thành rộng mở nhưng lại chọn chuyền bóng cho đồng "
                "đội theo lời khuyên chơi đồng đội của huấn luyện viên. Cú sút sau đó đập cột "
                "dọc, khiến trường của cậu đánh mất tấm vé tới giải toàn quốc.\n\n"
                "Đêm hôm đó, trong nỗi dằn vặt vì không tự mình dứt điểm, Isagi nhận được lá thư "
                "triệu tập từ Liên đoàn Bóng đá Nhật Bản. Tại hội trường tập trung ba trăm tiền "
                "đạo xuất sắc nhất lứa U18, người đàn ông lập dị Ego Jinpachi bước lên bục.\n\n"
                "Ego tuyên bố bóng đá Nhật Bản thất bại vì thiếu đi một trung phong mang bản ngã "
                "ích kỷ tuyệt đối. Toàn bộ thí sinh muốn đổi đời phải bước qua cánh cửa dự án "
                "nhà tù bóng đá mang tên Blue Lock.",
            ),
            (
                2.0,
                "Chương 2: Trò chơi sinh tồn trong phòng Z",
                "Không kịp suy nghĩ nhiều, Isagi lao thẳng vào cánh cửa trại huấn luyện và được "
                "xếp vào Đội Z với thứ hạng gần như đội sổ trên bảng xếp hạng nội bộ. Tại căn "
                "phòng chung đầu tiên, mười một tiền đạo trẻ lập tức nhận ra tất cả đều cạnh "
                "tranh cho một vị trí duy nhất.\n\n"
                "Thử thách mở màn chỉ kéo dài hơn hai phút dưới hình thức trò chơi đuổi bắt "
                "bằng bóng đá: ai bị bóng chạm trúng khi hết giờ sẽ bị loại vĩnh viễn khỏi giấc "
                "mơ đội tuyển quốc gia. Bầu không khí căng như dây đàn bao trùm căn phòng kín.\n\n"
                "Trong những giây cuối nghẹt thở, cầu thủ kỳ quặc Bachira Meguru bất ngờ chuyền "
                "bóng cho Isagi thay vì né tránh, đánh thức bản năng tìm kiếm đối thủ mạnh nhất "
                "bên trong cậu.",
            ),
            (
                3.0,
                "Chương 3: Cú vô lê phá vỡ giới hạn",
                "Còn chưa đầy mười giây trước khi đồng hồ đếm ngược kết thúc, Isagi cầm bóng "
                "đối mặt với Kira Ryosuke, ngôi sao trẻ sáng giá nhất của bóng đá trung học Nhật "
                "Bản vốn luôn tự hào về lối đá tập thể chuẩn mực.\n\n"
                "Thay vì chuyền sang mục tiêu dễ dàng là cậu bạn nhỏ con Igarashi đang nằm gục, "
                "Isagi lắng nghe trực giác mách bảo rằng muốn trở thành kẻ mạnh nhất, cậu phải "
                "hạ gục chính người đứng đầu. Cậu vung chân sút thẳng quả bóng với toàn bộ sức lực.\n\n"
                "Cú đá đập trúng mặt Kira đúng khoảnh khắc còi báo hết giờ vang lên. Kira bị "
                "loại trong sự bàng hoàng của cả Đội Z, còn Isagi lần đầu cảm nhận trọn vẹn sự "
                "khoái cảm của một tiền đạo ích kỷ thực thụ.",
            ),
        ),
    },
    {
        "title": "Frieren: Pháp Sư Tiễn Táng",
        "author": "Kanehito Yamada",
        "genre": "Fantasy",
        "status": "Đang tiến hành",
        "cover_url": "/covers/frieren.jpg",
        "rating": 4.9,
        "description": (
            "Sau mười năm cùng nhóm anh hùng đánh bại Ma Vương, nữ pháp sư tộc Elf trường "
            "sinh Frieren chứng kiến những người bạn đồng hành lần lượt già đi và bắt đầu "
            "chuyến hành trình mới để thấu hiểu trái tim con người."
        ),
        "chapters": (
            (
                1.0,
                "Chương 1: Điểm kết thúc của cuộc phiêu lưu",
                "Khải hoàn trở về kinh đô sau mười năm gian khổ đánh bại Ma Vương, tổ đội anh "
                "hùng gồm Himmel, Heiter, Eisen và nữ pháp sư Elf Frieren được người dân tung hô "
                "giữa những cánh hoa rơi rợp trời. Với tuổi thọ hàng nghìn năm của tộc Elf, quãng "
                "thời gian một thập kỷ ấy đối với Frieren chỉ thoáng qua như cái chớp mắt.\n\n"
                "Trước khi chia tay, cả bốn cùng ngắm trận mưa sao băng nửa thế kỷ mới xuất hiện "
                "một lần và hẹn sẽ quay lại ngắm cảnh đẹp hơn vào năm mươi năm sau. Frieren tiếp "
                "tục chu du một mình khắp lục địa để sưu tầm những phép thuật kỳ lạ.\n\n"
                "Đúng năm thập kỷ trôi qua, Frieren quay lại thăm Himmel nay đã thành ông lão "
                "lưng còng râu bạc. Sau chuyến ngắm mưa sao băng cuối cùng, anh hùng Himmel qua "
                "đời, để lại trong lòng Frieren giọt nước mắt hối tiếc vì đã quá thờ ơ tìm hiểu "
                "về người bạn thân nhất.",
            ),
            (
                2.0,
                "Chương 2: Lời gửi gắm của mục sư Heiter",
                "Vài năm sau lễ tang của Himmel, Frieren tìm đến khu rừng ngoại ô kinh đô nơi "
                "mục sư Heiter đang dưỡng già cùng một cô bé mồ côi lặng lẽ tên Fern. Dù mang "
                "bệnh nặng sắp qua đời, Heiter vẫn giữ nụ cười hóm hỉnh như thời trẻ.\n\n"
                "Nhằm giữ Frieren ở lại bên cạnh và giúp cô bé Fern có chỗ dựa, ông nhờ nữ pháp "
                "sư giải mã một quyển sách cổ viết về phép thuật bất tử. Mỗi ngày trôi qua, "
                "Frieren vừa dịch sách vừa hướng dẫn Fern kiểm soát lượng ma lực bên trong cơ thể.\n\n"
                "Sau hơn bốn năm ròng rã, quyển cổ thư thực chất chỉ là những trang ghi chép "
                "về cái chết bình yên khi đã hoàn tất tâm nguyện. Trước khi nhắm mắt, Heiter "
                "an lòng giao phó cô học trò nhỏ cho Frieren đưa đi khắp nhân gian.",
            ),
            (
                3.0,
                "Chương 3: Mùa hoa ánh trăng xanh",
                "Cùng Fern rời khỏi căn nhà gỗ nhỏ sau khi chôn cất người thầy quá cố, Frieren "
                "bước vào hành trình ngược về phương Bắc hướng tới vùng đất linh hồn Aureole, "
                "nơi cô hy vọng có thể một lần nữa trò chuyện với linh hồn Himmel.\n\n"
                "Khi ghé ngang một ngôi làng nhỏ ven đường, bà cụ địa phương nhờ Frieren lau sạch "
                "bức tượng đá cũ kỹ của vị anh hùng năm xưa đã phủ đầy rêu phong. Dù hiểu rõ thời "
                "gian sẽ làm phai mờ nhiều ký ức, Frieren vẫn kiên nhẫn tìm kiếm loại hoa xanh "
                "mà Himmel từng yêu thích thuở còn sống.\n\n"
                "Nhờ sự hỗ trợ của Fern và cuốn sách thảo dược cổ, cả hai tìm ra loài hoa ánh "
                "trăng xanh đã tuyệt tích quanh khu vực ấy nở rộ trên một ngọn tháp cổ. Dưới "
                "vầng sáng dịu nhẹ của cánh hoa, nụ cười thanh thản của Frieren cho thấy hành "
                "trình thấu hiểu con người mới chỉ thực sự bắt đầu.",
            ),
        ),
    },
)


def seed_catalog(db: Session) -> int:
    existing_count = db.scalar(select(func.count(Manga.id))) or 0
    if existing_count > 0:
        return 0

    inserted = 0
    for item in _SEED_MANGAS:
        manga = Manga(
            title=str(item["title"]),
            author=str(item["author"]),
            genre=str(item["genre"]),
            status=str(item["status"]),
            cover_url=str(item["cover_url"]),
            description=str(item["description"]),
            rating=float(item["rating"]),
            views=0,
            created_by=None,
        )
        db.add(manga)
        db.flush()

        chapters = item["chapters"]
        for chapter_number, chapter_title, content in chapters:
            db.add(
                Chapter(
                    manga_id=manga.id,
                    chapter_number=float(chapter_number),
                    title=str(chapter_title),
                    content=str(content),
                )
            )
        inserted += 1

    db.commit()
    return inserted
