using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MgtSign.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class LiveSigning : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "LiveEvidence",
                table: "Recipients",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LiveHostEmail",
                table: "Recipients",
                type: "nvarchar(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LiveHostName",
                table: "Recipients",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LiveIdentityCheck",
                table: "Recipients",
                type: "nvarchar(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LiveStartedAt",
                table: "Recipients",
                type: "datetime2(3)",
                precision: 3,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LiveEvidence",
                table: "Recipients");

            migrationBuilder.DropColumn(
                name: "LiveHostEmail",
                table: "Recipients");

            migrationBuilder.DropColumn(
                name: "LiveHostName",
                table: "Recipients");

            migrationBuilder.DropColumn(
                name: "LiveIdentityCheck",
                table: "Recipients");

            migrationBuilder.DropColumn(
                name: "LiveStartedAt",
                table: "Recipients");
        }
    }
}
